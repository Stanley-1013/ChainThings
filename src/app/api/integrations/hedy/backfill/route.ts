import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HedyClient, HedyApiError } from "@/lib/integrations/hedy/client";
import type { HedySession, HedyTodo } from "@/lib/integrations/hedy/client";
import { NextResponse } from "next/server";

const RATE_LIMIT_DELAY_MS = 350;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildContent(session: HedySession): string {
  const parts: string[] = [];
  if (session.meeting_minutes) parts.push(session.meeting_minutes);
  if (session.recap) parts.push(session.recap);
  if (session.transcript) parts.push(session.transcript);
  return parts.join("\n\n---\n\n");
}

function buildMetadata(session: HedySession): Record<string, unknown> {
  return {
    source: "hedy.ai",
    event: "backfill",
    session_type: session.session_type ?? null,
    topic: session.topic?.name ?? null,
    duration: session.duration ?? null,
    startTime: session.startTime ?? null,
    endTime: session.endTime ?? null,
    recap: session.recap ?? null,
    highlights: session.highlights ?? null,
    user_todos: session.user_todos ?? null,
  };
}

function extractActiveTodos(session: HedySession): HedyTodo[] {
  if (!session.user_todos || !Array.isArray(session.user_todos)) return [];
  return session.user_todos.filter((t) => !t.completed);
}

/** Validate and parse dueDate — Hedy may return natural language like "next week". */
function parseValidDate(dueDate: string | null | undefined): string | undefined {
  if (!dueDate) return undefined;
  const d = new Date(dueDate);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export async function POST() {
  // --- Auth ---
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

  const tenantId = profile.tenant_id as string;

  // --- Load Hedy API key ---
  const { data: integration } = await supabaseAdmin
    .from("chainthings_integrations")
    .select("config")
    .eq("tenant_id", tenantId)
    .eq("service", "hedy.ai")
    .is("dev_project_id", null)
    .single();

  const apiKey = integration?.config?.api_key;
  if (typeof apiKey !== "string" || apiKey.length === 0 || apiKey.includes("•")) {
    return NextResponse.json(
      { error: "No Hedy API key configured" },
      { status: 400 },
    );
  }

  const client = new HedyClient({ apiKey });

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // Iterate session stubs (list API), then fetch full detail only for new sessions
    for await (const stub of client.iterateAllSessionIds()) {
      try {
        // Check if already imported BEFORE calling getSession (saves an API call)
        const { data: existing } = await supabaseAdmin
          .from("chainthings_items")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("external_id", stub.sessionId)
          .single();

        if (existing) {
          skipped++;
          continue;
        }

        // Fetch full session detail (transcript, recap, todos, highlights)
        const session = await client.getSession(stub.sessionId);
        await sleep(RATE_LIMIT_DELAY_MS);

        // Insert new item
        const content = buildContent(session);
        const metadata = buildMetadata(session);
        const title = session.title || "Untitled Meeting";

        const { data: item, error: insertError } = await supabaseAdmin
          .from("chainthings_items")
          .insert({
            tenant_id: tenantId,
            type: "meeting_note",
            title,
            content,
            external_id: session.sessionId,
            metadata,
          })
          .select("id")
          .single();

        if (insertError) {
          // Handle unique-violation race condition
          if (insertError.code === "23505") {
            skipped++;
          } else {
            console.error(
              `Backfill insert failed for session ${session.sessionId}:`,
              insertError.message,
            );
            errors++;
          }
          await sleep(RATE_LIMIT_DELAY_MS);
          continue;
        }

        // Extract active todos into memory entries
        const activeTodos = extractActiveTodos(session);
        if (activeTodos.length > 0 && item) {
          const { error: todoError } = await supabaseAdmin
            .from("chainthings_memory_entries")
            .insert(
              activeTodos.map((todo) => {
                const validDate = parseValidDate(todo.dueDate);
                return {
                  tenant_id: tenantId,
                  category: "task" as const,
                  content: todo.text,
                  importance: 7,
                  source_type: "item",
                  source_id: item.id,
                  ...(validDate ? { due_date: validDate } : {}),
                };
              }),
            );

          if (todoError) {
            console.error(
              `Backfill todo insert failed for session ${session.sessionId}:`,
              todoError.message,
            );
            // Non-fatal: item was still imported
          }
        }

        imported++;
      } catch (err) {
        if (err instanceof HedyApiError && err.status === 429) {
          const retryAfter =
            (err.body as { retryAfter?: number } | null)?.retryAfter ?? 30;
          console.warn(
            `Hedy rate limit hit, waiting ${retryAfter}s before retry`,
          );
          await sleep(retryAfter * 1000);
          // Don't increment errors — this session will be picked up on next backfill run
          errors++;
        } else {
          console.error(
            "Backfill session error:",
            err instanceof Error ? err.message : String(err),
          );
          errors++;
        }
      }

      await sleep(RATE_LIMIT_DELAY_MS);
    }
  } catch (err) {
    // Top-level iteration error (e.g. pagination failure, auth error)
    if (err instanceof HedyApiError) {
      return NextResponse.json(
        {
          error: err.message,
          imported,
          skipped,
          errors,
        },
        { status: err.status === 401 ? 400 : 502 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, imported, skipped, errors },
      { status: 502 },
    );
  }

  return NextResponse.json({ imported, skipped, errors });
}
