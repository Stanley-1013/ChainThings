import { supabaseAdmin as adminDb } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

const TASK_LIMIT = 8;
const TASK_SNIPPET_CHARS = 80;
const MANUAL_COOLDOWN_MS = 60_000; // 1 minute cooldown for manual triggers

function buildDeterministicSummary(
  recentItems: Array<{ title?: string | null; metadata?: unknown }> | null | undefined,
  actionItemCount: number,
  meetingCount: number
): string {
  let summary = "";
  for (const item of recentItems ?? []) {
    const metadata = item.metadata as Record<string, unknown> | null;
    const rawSummary = (metadata?.summary as string) || (metadata?.recap as string) || "";
    const itemSummary = rawSummary.trim().length > 0
      ? rawSummary.trim().slice(0, 150)
      : typeof item.title === "string"
        ? item.title.trim()
        : "";
    if (!itemSummary) continue;
    const next = summary ? `${summary}；${itemSummary}` : itemSummary;
    if (next.length > 200) {
      if (!summary) summary = itemSummary.slice(0, 200).trim();
      break;
    }
    summary = next;
  }
  return summary || `本期有 ${actionItemCount} 筆待辦事項和 ${meetingCount} 筆會議記錄。`;
}

function extractKeyPoints(
  recentItems: Array<{ metadata?: unknown }> | null | undefined
): string[] {
  const keyPoints: string[] = [];
  for (const item of recentItems ?? []) {
    const metadata = item.metadata as Record<string, unknown> | null;
    if (!Array.isArray(metadata?.keyPoints)) continue;
    for (const point of metadata.keyPoints) {
      if (typeof point === "string" && point.trim().length > 0) {
        keyPoints.push(point.trim());
      }
    }
  }
  return keyPoints;
}


interface Target {
  tenant_id: string;
  user_id: string;
  timezone: string;
  frequency: string;
  send_hour_local: number;
}

async function getLastWatermark(tenantId: string, userId: string): Promise<string | null> {
  const { data, error } = await adminDb
    .from("chainthings_notification_cache")
    .select("source_watermark")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .order("source_watermark", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Failed to get watermark: ${error.message}`);
  return data?.[0]?.source_watermark || null;
}

async function hasNewData(tenantId: string, watermark: string | null): Promise<boolean> {
  const since = watermark || "1970-01-01T00:00:00Z";
  const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  const [itemsRes, tasksRes, urgentRes] = await Promise.all([
    adminDb.from("chainthings_items").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).or(`created_at.gt.${since},updated_at.gt.${since}`),
    adminDb.from("chainthings_memory_entries").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("status", "active").eq("category", "task")
      .or(`created_at.gt.${since},updated_at.gt.${since}`),
    adminDb.from("chainthings_memory_entries").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("status", "active").eq("category", "task")
      .not("due_date", "is", null).lte("due_date", threeDaysFromNow)
      .or(`created_at.gt.${since},updated_at.gt.${since}`),
  ]);

  if (itemsRes.error) throw new Error(`Failed to check items: ${itemsRes.error.message}`);
  if (tasksRes.error) throw new Error(`Failed to check tasks: ${tasksRes.error.message}`);
  if (urgentRes.error) throw new Error(`Failed to check urgent tasks: ${urgentRes.error.message}`);

  return !!(
    (itemsRes.count && itemsRes.count > 0) ||
    (tasksRes.count && tasksRes.count > 0) ||
    (urgentRes.count && urgentRes.count > 0)
  );
}

async function generateForTarget(target: Target): Promise<boolean> {
  const watermark = await getLastWatermark(target.tenant_id, target.user_id);
  const hasNew = await hasNewData(target.tenant_id, watermark);

  if (!hasNew) return false; // No new data — skip AI call

  const periodEnd = new Date();
  const periodStart = new Date();
  if (target.frequency === "daily") {
    periodStart.setDate(periodStart.getDate() - 1);
  } else if (target.frequency === "biweekly") {
    periodStart.setDate(periodStart.getDate() - 14);
  } else if (target.frequency === "every3days") {
    periodStart.setDate(periodStart.getDate() - 3);
  } else {
    periodStart.setDate(periodStart.getDate() - 7);
  }

  // Parallel fetch: items + tasks + upcoming deadlines
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const [itemsRes, memoriesRes, upcomingRes] = await Promise.all([
    adminDb.from("chainthings_items")
      .select("title, content, metadata, created_at, updated_at")
      .eq("tenant_id", target.tenant_id)
      .gte("created_at", periodStart.toISOString())
      .order("created_at", { ascending: false }).limit(20),
    adminDb.from("chainthings_memory_entries")
      .select("category, content, created_at, updated_at")
      .eq("tenant_id", target.tenant_id).eq("status", "active").eq("category", "task")
      .order("importance", { ascending: false }).limit(20),
    adminDb.from("chainthings_memory_entries")
      .select("content, due_date")
      .eq("tenant_id", target.tenant_id).eq("status", "active").eq("category", "task")
      .not("due_date", "is", null).lte("due_date", sevenDaysFromNow)
      .order("due_date", { ascending: true }).limit(10),
  ]);

  if (itemsRes.error) throw new Error(`Failed to fetch items: ${itemsRes.error.message}`);
  if (memoriesRes.error) throw new Error(`Failed to fetch tasks: ${memoriesRes.error.message}`);
  if (upcomingRes.error) console.warn(`[notifications] Failed to fetch deadlines: ${upcomingRes.error.message}`);

  const recentItems = itemsRes.data;
  const memories = memoriesRes.data;
  const upcomingTasks = upcomingRes.data ?? [];

  if (!recentItems?.length && !memories?.length && !upcomingTasks?.length) return false;

  // Step 1: Build structured data from DB (deterministic)
  const actionItems = (memories ?? []).slice(0, TASK_LIMIT).map((m) => ({
    task: m.content.slice(0, TASK_SNIPPET_CHARS),
    priority: "medium" as string,
  }));

  const now = Date.now();
  const reminders = (upcomingTasks ?? []).map((d) => {
    const days = Math.ceil((new Date(d.due_date).getTime() - now) / (24 * 60 * 60 * 1000));
    const label = days <= 0 ? "已逾期" : days === 1 ? "明天到期" : `${days} 天後到期`;
    return `${d.content.slice(0, TASK_SNIPPET_CHARS)}（${label}）`;
  });

  const recentMeetings = (recentItems ?? []).slice(0, 5).map((item) => ({
    title: item.title || "未命名會議",
    date: item.created_at,
  }));

  const summary = buildDeterministicSummary(recentItems, actionItems.length, recentMeetings.length);
  const keyPoints = extractKeyPoints(recentItems);

  const parsed = { summary, keyPoints, actionItems, reminders, recentMeetings };

  // Watermark = max timestamp from sources actually included in this generation
  // This prevents race conditions where data inserted during AI call gets skipped
  const allTimestamps = [
    ...(recentItems || []).flatMap((i) => [i.created_at, i.updated_at].filter(Boolean)),
    ...(memories || []).flatMap((m) => [m.created_at, m.updated_at].filter(Boolean)),
  ];
  const maxSourceTimestamp = allTimestamps.length > 0
    ? new Date(Math.max(...allTimestamps.map((t) => new Date(t as string).getTime()))).toISOString()
    : new Date().toISOString();

  await adminDb.from("chainthings_notification_cache").upsert(
    {
      tenant_id: target.tenant_id,
      user_id: target.user_id,
      period_start: periodStart.toISOString().split("T")[0],
      period_end: periodEnd.toISOString().split("T")[0],
      content: parsed,
      source_watermark: maxSourceTimestamp,
      scheduled_for_utc: new Date().toISOString(),
      status: "generated",
    },
    { onConflict: "tenant_id,user_id,period_start,period_end" }
  );

  await adminDb
    .from("chainthings_notification_settings")
    .update({ last_generated_at: new Date().toISOString() })
    .eq("tenant_id", target.tenant_id)
    .eq("user_id", target.user_id);

  return true;
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  let targetUsers: Target[] = [];
  let isManual = false;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    // Cron mode: find all users needing notification generation
    const now = new Date();
    const { data: settings } = await adminDb
      .from("chainthings_notification_settings")
      .select("tenant_id, user_id, timezone, frequency, send_hour_local, last_generated_at")
      .eq("enabled", true);

    if (!settings?.length) {
      return NextResponse.json({ data: { generated: 0 } });
    }

    for (const s of settings) {
      const userNow = new Date(now.toLocaleString("en-US", { timeZone: s.timezone }));
      if (userNow.getHours() !== (s.send_hour_local ?? 9)) continue;

      if (s.last_generated_at) {
        const lastGen = new Date(s.last_generated_at);
        const hoursSince = (now.getTime() - lastGen.getTime()) / (1000 * 60 * 60);
        if (s.frequency === "daily" && hoursSince < 20) continue;
        if (s.frequency === "every3days" && hoursSince < 3 * 24 - 4) continue;
        if (s.frequency === "biweekly" && hoursSince < 14 * 24) continue;
        if (s.frequency === "weekly" && hoursSince < 7 * 24) continue;
      }

      targetUsers.push({
        tenant_id: s.tenant_id,
        user_id: s.user_id,
        timezone: s.timezone,
        frequency: s.frequency,
        send_hour_local: s.send_hour_local ?? 9,
      });
    }
  } else {
    // User mode: generate for the requesting user
    isManual = true;
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("chainthings_profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    // Cooldown check: prevent manual spam
    const { data: lastNotif } = await adminDb
      .from("chainthings_notification_cache")
      .select("source_watermark")
      .eq("tenant_id", profile.tenant_id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (lastNotif?.[0]?.source_watermark) {
      const lastTime = new Date(lastNotif[0].source_watermark).getTime();
      if (Date.now() - lastTime < MANUAL_COOLDOWN_MS) {
        // Check if there's actually new data before enforcing cooldown
        const hasNew = await hasNewData(profile.tenant_id, lastNotif[0].source_watermark);
        if (!hasNew) {
          return NextResponse.json({
            data: { generated: 0, skipped: true, reason: "no_new_data" },
          });
        }
      }
    }

    const { data: userSettings } = await supabase
      .from("chainthings_notification_settings")
      .select("timezone, frequency, send_hour_local")
      .eq("tenant_id", profile.tenant_id)
      .eq("user_id", user.id)
      .single();

    targetUsers = [{
      tenant_id: profile.tenant_id,
      user_id: user.id,
      timezone: userSettings?.timezone ?? "UTC",
      frequency: userSettings?.frequency ?? "weekly",
      send_hour_local: userSettings?.send_hour_local ?? 9,
    }];
  }

  let generated = 0;
  let skipped = 0;

  for (const target of targetUsers) {
    try {
      const didGenerate = await generateForTarget(target);
      if (didGenerate) {
        generated++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`Failed to generate notification for ${target.user_id}:`, err);
    }
  }

  return NextResponse.json({
    data: {
      generated,
      skipped,
      ...(isManual && skipped > 0 && { reason: "no_new_data" }),
    },
  });
}
