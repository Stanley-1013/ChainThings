import { supabaseAdmin as adminDb } from "@/lib/supabase/admin";
import { chatCompletion } from "@/lib/ai-gateway";
import { NextResponse } from "next/server";

const ITEM_LIMIT = 8;
const ITEM_SNIPPET_CHARS = 120;
const TASK_LIMIT = 8;
const TASK_SNIPPET_CHARS = 80;
const MANUAL_COOLDOWN_MS = 60_000; // 1 minute cooldown for manual triggers

function buildBoundedLines(
  lines: string[],
  maxItems: number,
  maxCharsPerItem: number
): string[] {
  return lines
    .filter(Boolean)
    .slice(0, maxItems)
    .map((line) =>
      line.length <= maxCharsPerItem
        ? line
        : `${line.slice(0, maxCharsPerItem).trimEnd()}...`
    );
}

const NOTIFICATION_PROMPT = `You are a personal assistant generating a brief notification digest.
Based on the following meeting notes and tasks, create a concise summary.
Return JSON with:
- "summary": 2-3 sentence overview of the period
- "actionItems": array of pending tasks with "task" and "priority" (high/medium/low)
- "reminders": array of things the user should be aware of

Keep it concise and actionable. Respond ONLY with valid JSON.`;

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
      .not("due_date", "is", null).lte("due_date", threeDaysFromNow),
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

  const recentItems = itemsRes.data;
  const memories = memoriesRes.data;
  const upcomingTasks = upcomingRes.data;

  if (!recentItems?.length && !memories?.length && !upcomingTasks?.length) return false;

  const contextParts: string[] = [];
  if (recentItems?.length) {
    contextParts.push("Recent Meeting Notes:");
    for (const line of buildBoundedLines(
      recentItems.map((item) => `${item.title}: ${item.content || ""}`),
      ITEM_LIMIT,
      ITEM_SNIPPET_CHARS
    )) {
      contextParts.push(`- ${line}`);
    }
  }
  if (memories?.length) {
    contextParts.push("\nPending Tasks:");
    for (const line of buildBoundedLines(
      memories.map((m) => m.content),
      TASK_LIMIT,
      TASK_SNIPPET_CHARS
    )) {
      contextParts.push(`- ${line}`);
    }
  }
  if (upcomingTasks?.length) {
    contextParts.push("\nUpcoming Deadlines (prioritize these):");
    const now = Date.now();
    for (const t of upcomingTasks) {
      const daysLeft = Math.ceil((new Date(t.due_date).getTime() - now) / (24 * 60 * 60 * 1000));
      const urgency = daysLeft <= 1 ? "⚠️ TODAY/OVERDUE" : daysLeft <= 3 ? "URGENT" : `${daysLeft} days left`;
      contextParts.push(`- [${urgency}] ${t.content.slice(0, TASK_SNIPPET_CHARS)}`);
    }
  }

  const response = await chatCompletion([
    { role: "system", content: NOTIFICATION_PROMPT },
    { role: "user", content: contextParts.join("\n") },
  ]);

  let aiContent = response.choices[0]?.message?.content || "{}";
  // Strip markdown code block wrapper (```json ... ```)
  const jsonBlockMatch = aiContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (jsonBlockMatch) aiContent = jsonBlockMatch[1].trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(aiContent);
  } catch {
    // Try extracting any JSON object from the response
    const objMatch = aiContent.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { parsed = JSON.parse(objMatch[0]); } catch { parsed = { summary: aiContent, actionItems: [], reminders: [] }; }
    } else {
      parsed = { summary: aiContent, actionItems: [], reminders: [] };
    }
  }

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
