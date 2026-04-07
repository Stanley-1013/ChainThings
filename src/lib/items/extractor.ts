import { chatCompletion, type ChatCompletionOptions } from "@/lib/ai-gateway";
import { supabaseAdmin } from "@/lib/supabase/admin";

const EXTRACT_PROMPT = `You are a meeting notes analyzer. Extract structured information from the provided text.
Return a JSON object with these fields:
- "title": a concise title for the meeting (max 100 chars)
- "keyPoints": array of key discussion points (max 10)
- "actionItems": array of action items/tasks with "task" and "assignee" fields
- "summary": a 2-3 sentence summary

Respond ONLY with valid JSON, no markdown.`;

const EXTRACT_TIMEOUT_MS = 30_000;

export async function extractItemMetadata(
  itemId: string,
  tenantId: string,
  aiOptions?: ChatCompletionOptions
): Promise<{ extracted: Record<string, unknown> } | null> {
  const { data: item } = await supabaseAdmin
    .from("chainthings_items")
    .select("*")
    .eq("id", itemId)
    .eq("tenant_id", tenantId)
    .single();

  if (!item) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

  try {
    const response = await chatCompletion(
      [
        { role: "system", content: EXTRACT_PROMPT },
        { role: "user", content: item.content || item.title || "" },
      ],
      undefined,
      { ...aiOptions, tenantId }
    );

    const content = response.choices[0]?.message?.content || "{}";
    let extracted: Record<string, unknown>;
    try {
      extracted = JSON.parse(content);
    } catch {
      extracted = { raw: content };
    }

    const newMetadata = {
      ...(item.metadata || {}),
      ...extracted,
      extractedAt: new Date().toISOString(),
    };

    await supabaseAdmin
      .from("chainthings_items")
      .update({
        title: (extracted.title as string) || item.title,
        metadata: newMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);

    // Create memory entries from action items
    const actionItems = extracted.actionItems as Array<{ task: string; assignee?: string }> | undefined;
    if (actionItems?.length) {
      await supabaseAdmin
        .from("chainthings_memory_entries")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("source_type", "item")
        .eq("source_id", itemId)
        .eq("category", "task");

      await supabaseAdmin.from("chainthings_memory_entries").insert(
        actionItems.map((ai) => ({
          tenant_id: tenantId,
          category: "task" as const,
          content: ai.assignee ? `${ai.task} (assigned to: ${ai.assignee})` : ai.task,
          importance: 7,
          source_type: "item",
          source_id: itemId,
        }))
      );
    }

    return { extracted: newMetadata };
  } finally {
    clearTimeout(timer);
  }
}
