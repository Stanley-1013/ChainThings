import { supabaseAdmin as adminDb } from "@/lib/supabase/admin";
import { chatCompletion } from "@/lib/ai-gateway";
import { NextResponse } from "next/server";

const ITEM_LIMIT = 8;
const ITEM_SNIPPET_CHARS = 120;
const TASK_LIMIT = 8;
const TASK_SNIPPET_CHARS = 80;

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

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  let targetUsers: Array<{ tenant_id: string; user_id: string; timezone: string; frequency: string; send_hour_local: number }> = [];

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

    // Read user's actual notification settings
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

  for (const target of targetUsers) {
    try {
      const periodEnd = new Date();
      const periodStart = new Date();
      if (target.frequency === "daily") {
        periodStart.setDate(periodStart.getDate() - 1);
      } else if (target.frequency === "biweekly") {
        periodStart.setDate(periodStart.getDate() - 14);
      } else {
        periodStart.setDate(periodStart.getDate() - 7);
      }

      const { data: recentItems } = await adminDb
        .from("chainthings_items")
        .select("title, content, metadata")
        .eq("tenant_id", target.tenant_id)
        .gte("created_at", periodStart.toISOString())
        .order("created_at", { ascending: false })
        .limit(20);

      const { data: memories } = await adminDb
        .from("chainthings_memory_entries")
        .select("category, content")
        .eq("tenant_id", target.tenant_id)
        .eq("status", "active")
        .eq("category", "task")
        .order("importance", { ascending: false })
        .limit(20);

      if (!recentItems?.length && !memories?.length) continue;

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

      const response = await chatCompletion([
        { role: "system", content: NOTIFICATION_PROMPT },
        { role: "user", content: contextParts.join("\n") },
      ]);

      const aiContent = response.choices[0]?.message?.content || "{}";
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(aiContent);
      } catch {
        parsed = { summary: aiContent, actionItems: [], reminders: [] };
      }

      await adminDb.from("chainthings_notification_cache").upsert(
        {
          tenant_id: target.tenant_id,
          user_id: target.user_id,
          period_start: periodStart.toISOString().split("T")[0],
          period_end: periodEnd.toISOString().split("T")[0],
          content: parsed,
          source_watermark: new Date().toISOString(),
          scheduled_for_utc: new Date().toISOString(),
        },
        { onConflict: "tenant_id,user_id,period_start,period_end" }
      );

      await adminDb
        .from("chainthings_notification_settings")
        .update({ last_generated_at: new Date().toISOString() })
        .eq("tenant_id", target.tenant_id)
        .eq("user_id", target.user_id);

      generated++;
    } catch (err) {
      console.error(`Failed to generate notification for ${target.user_id}:`, err);
    }
  }

  return NextResponse.json({ data: { generated } });
}
