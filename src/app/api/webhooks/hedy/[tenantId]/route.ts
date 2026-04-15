import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractItemMetadata } from "@/lib/items/extractor";
import { NextResponse, after } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

// Hedy webhook event types (from official API docs)
// session.created — minimal stub, no content yet
// session.ended — full session with transcript, recap, todos, highlights
// session.exported — manual export, same structure as session.ended
// highlight.created — single highlight
// todo.exported — single todo item {id, sessionId, text, dueDate}
const FINAL_EVENTS = new Set([
  "session.ended",
  "session.exported",
]);

async function getTenantWebhookSecret(tenantId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("chainthings_integrations")
    .select("webhook_secret")
    .eq("tenant_id", tenantId)
    .eq("service", "hedy.ai")
    .single();
  return data?.webhook_secret ?? null;
}

function verifySignature(
  tenantId: string,
  timestamp: string,
  signature: string,
  body: string,
  secret: string
): boolean {
  const payload = `${tenantId}:${timestamp}:${body}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function mergeContent(existing: string, incoming: string): string {
  if (!existing) return incoming;
  if (!incoming) return existing;
  // Avoid duplicating content
  if (existing.includes(incoming)) return existing;
  return `${existing}\n\n---\n\n${incoming}`;
}

function mergeMetadata(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === undefined) continue;
    // Arrays: concat and deduplicate
    if (Array.isArray(value) && Array.isArray(merged[key])) {
      const seen = new Set((merged[key] as unknown[]).map((v) => JSON.stringify(v)));
      const unique = (value as unknown[]).filter((v) => !seen.has(JSON.stringify(v)));
      merged[key] = [...(merged[key] as unknown[]), ...unique];
    } else if (value !== null) {
      merged[key] = value;
    }
  }
  merged.lastUpdatedAt = new Date().toISOString();
  return merged;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;

  // Per-tenant secret authentication
  const tenantSecret = await getTenantWebhookSecret(tenantId);
  if (!tenantSecret) {
    return NextResponse.json(
      { error: "Webhook not configured for this tenant" },
      { status: 401 }
    );
  }

  const sharedSecret = request.headers.get("x-chainthings-secret");
  const timestamp = request.headers.get("x-chainthings-timestamp");
  const signature = request.headers.get("x-chainthings-signature");

  const rawBody = await request.text();

  if (sharedSecret) {
    const secretMatch = sharedSecret.length === tenantSecret.length &&
      timingSafeEqual(Buffer.from(sharedSecret), Buffer.from(tenantSecret));
    if (!secretMatch) {
      return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
    }
  } else if (timestamp && signature) {
    const requestTime = parseInt(timestamp, 10);
    if (
      isNaN(requestTime) ||
      Math.abs(Date.now() - requestTime) > TIMESTAMP_TOLERANCE_MS
    ) {
      return NextResponse.json({ error: "Request expired" }, { status: 401 });
    }
    if (!verifySignature(tenantId, timestamp, signature, rawBody, tenantSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else {
    return NextResponse.json({ error: "Missing authentication headers" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Verify tenant exists
  const { data: profile } = await supabaseAdmin
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Invalid tenant" }, { status: 400 });
  }

  const event = typeof body.event === "string" ? body.event : null;
  const isTodoExported = event === "todo.exported";

  const type = typeof body.type === "string" ? body.type : "meeting_note";
  const title = typeof body.title === "string" ? body.title.slice(0, 500) : "Untitled";
  const content = typeof body.content === "string" ? body.content : "";
  // todo.exported has sessionId at body level for linking to the parent session
  const externalId = typeof body.external_id === "string" ? body.external_id.slice(0, 255) : null;
  const incomingMetadata = body.metadata && typeof body.metadata === "object"
    ? (body.metadata as Record<string, unknown>)
    : {};
  const isFinal = event ? FINAL_EVENTS.has(event) : !externalId;

  // Handle todo.exported: standalone todo, create memory entry directly
  if (isTodoExported) {
    const todoText = typeof body.text === "string" ? body.text : "";
    const todoDueDate = typeof body.dueDate === "string" ? body.dueDate : undefined;
    if (todoText) {
      // Link to parent session item if it exists
      let sourceId: string | null = null;
      if (externalId) {
        const { data: parentItem } = await supabaseAdmin
          .from("chainthings_items")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("external_id", externalId)
          .single();
        sourceId = parentItem?.id ?? null;
      }

      const insertData: Record<string, unknown> = {
        tenant_id: tenantId,
        category: "task",
        content: todoText,
        importance: 7,
        ...(todoDueDate ? { due_date: todoDueDate } : {}),
      };
      if (sourceId) {
        insertData.source_type = "item";
        insertData.source_id = sourceId;
      }
      const { error } = await supabaseAdmin.from("chainthings_memory_entries").insert(insertData);
      if (error) {
        console.error("Todo insert failed:", error.message);
        return NextResponse.json({ error: "Failed to save todo" }, { status: 500 });
      }
    }
    return NextResponse.json({ success: true, event: "todo.exported", task: todoText });
  }

  // Upsert: merge content if same session sends multiple times
  let itemId: string;
  let wasMerged = false;

  if (externalId) {
    const { data: existing } = await supabaseAdmin
      .from("chainthings_items")
      .select("id, content, title, metadata")
      .eq("tenant_id", tenantId)
      .eq("external_id", externalId)
      .single();

    if (existing) {
      const mergedContent = mergeContent(existing.content ?? "", content);
      const mergedMeta = mergeMetadata(
        (existing.metadata ?? {}) as Record<string, unknown>,
        incomingMetadata
      );
      // Update title only if current is "Untitled" or incoming is more specific
      const mergedTitle = existing.title === "Untitled" || existing.title === "Untitled Meeting"
        ? title
        : existing.title;

      const { error } = await supabaseAdmin
        .from("chainthings_items")
        .update({
          title: mergedTitle,
          content: mergedContent,
          metadata: mergedMeta,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (error) {
        console.error("Webhook update failed:", error.message);
        return NextResponse.json({ error: "Failed to update item" }, { status: 500 });
      }
      itemId = existing.id;
      wasMerged = true;
    } else {
      const { data, error } = await supabaseAdmin
        .from("chainthings_items")
        .insert({
          tenant_id: tenantId,
          type,
          title,
          content,
          external_id: externalId,
          metadata: incomingMetadata,
        })
        .select("id")
        .single();

      if (error) {
        // Unique violation = concurrent insert race; retry as update
        if (error.code === "23505") {
          const { data: raced } = await supabaseAdmin
            .from("chainthings_items")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("external_id", externalId)
            .single();
          if (raced) {
            await supabaseAdmin
              .from("chainthings_items")
              .update({ content: mergeContent("", content), metadata: incomingMetadata, updated_at: new Date().toISOString() })
              .eq("id", raced.id);
            itemId = raced.id;
            wasMerged = true;
          } else {
            return NextResponse.json({ error: "Failed to save item" }, { status: 500 });
          }
        } else {
          console.error("Webhook insert failed:", error.message);
          return NextResponse.json({ error: "Failed to save item" }, { status: 500 });
        }
      } else {
        itemId = data.id;
      }
    }
  } else {
    // No external_id — always insert (can't deduplicate)
    const { data, error } = await supabaseAdmin
      .from("chainthings_items")
      .insert({
        tenant_id: tenantId,
        type,
        title,
        content,
        metadata: incomingMetadata,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Webhook insert failed:", error.message);
      return NextResponse.json({ error: "Failed to save item" }, { status: 500 });
    }
    itemId = data.id;
  }

  // Save structured action items from Hedy (already AI-processed by Hedy)
  const structuredActions = extractStructuredActionItems(body, incomingMetadata);
  const hasStructuredActions = structuredActions.length > 0;

  if (hasStructuredActions) {
    after(async () => {
      try {
        await upsertActionItems(itemId, tenantId, structuredActions);
      } catch {
        // Non-fatal
      }
    });
  }

  // AI extraction on final event — but skip action item extraction if Hedy already provided them
  if (isFinal) {
    after(async () => {
      try {
        const { data: aiIntegrations } = await supabaseAdmin
          .from("chainthings_integrations")
          .select("service, config")
          .eq("tenant_id", tenantId)
          .in("service", ["zeroclaw", "openclaw"]);

        const zcIntegration = aiIntegrations?.find((i) => i.service === "zeroclaw");
        const ocIntegration = aiIntegrations?.find((i) => i.service === "openclaw");
        const aiConfig = (zcIntegration || ocIntegration)?.config as Record<string, unknown> | null;

        await extractItemMetadata(itemId, tenantId, {
          provider: zcIntegration ? "zeroclaw" : ocIntegration ? "openclaw" : undefined,
          token: (aiConfig?.api_token as string) || undefined,
          tenantId,
          skipActionItems: hasStructuredActions,
        });
      } catch {
        // Extraction failure is non-fatal
      }
    });
  }

  return NextResponse.json({
    success: true,
    id: itemId,
    merged: wasMerged,
    final: isFinal,
    actionItems: structuredActions.length,
  });
}

interface ActionItem {
  task: string;
  dueDate?: string;
  completed?: boolean;
}

function extractStructuredActionItems(
  body: Record<string, unknown>,
  metadata: Record<string, unknown>
): ActionItem[] {
  // Hedy schema: user_todos = [{id, text, dueDate, completed}]
  // n8n template forwards as body.todos and metadata.user_todos
  // Also handle todo.exported event: body itself is {id, sessionId, text, dueDate}
  const candidates = [
    body.todos,                // n8n forwards user_todos here
    body.user_todos,           // direct Hedy field name
    metadata.user_todos,       // also in metadata
    metadata.actionItems,      // legacy fallback
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || candidate.length === 0) continue;
    return candidate
      .filter((item): item is Record<string, unknown> => item && typeof item === "object")
      .map((item) => ({
        task: String(item.text || item.task || item.content || ""),
        dueDate: item.dueDate ? String(item.dueDate) : undefined,
        completed: typeof item.completed === "boolean" ? item.completed : undefined,
      }))
      .filter((item) => item.task.length > 0 && item.completed !== true);
  }

  // Handle single todo from todo.exported event
  if (typeof body.text === "string" && body.text.length > 0) {
    return [{
      task: body.text as string,
      dueDate: body.dueDate ? String(body.dueDate) : undefined,
    }];
  }

  return [];
}

async function upsertActionItems(
  itemId: string,
  tenantId: string,
  actions: ActionItem[]
): Promise<void> {
  // Remove existing tasks from this source, then insert fresh
  await supabaseAdmin
    .from("chainthings_memory_entries")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("source_type", "item")
    .eq("source_id", itemId)
    .eq("category", "task");

  await supabaseAdmin.from("chainthings_memory_entries").insert(
    actions.map((a) => ({
      tenant_id: tenantId,
      category: "task" as const,
      content: a.task,
      importance: 7,
      source_type: "item",
      source_id: itemId,
      ...(a.dueDate ? { due_date: a.dueDate } : {}),
    }))
  );
}
