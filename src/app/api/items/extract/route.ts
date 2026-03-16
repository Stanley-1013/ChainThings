import { createClient } from "@/lib/supabase/server";
import { chatCompletion, type ChatCompletionOptions } from "@/lib/ai-gateway";
import { NextResponse } from "next/server";

const EXTRACT_PROMPT = `You are a meeting notes analyzer. Extract structured information from the provided text.
Return a JSON object with these fields:
- "title": a concise title for the meeting (max 100 chars)
- "keyPoints": array of key discussion points (max 10)
- "actionItems": array of action items/tasks with "task" and "assignee" fields
- "summary": a 2-3 sentence summary

Respond ONLY with valid JSON, no markdown.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { itemId } = await request.json();
  if (!itemId) {
    return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile?.tenant_id) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Fetch the item
  const { data: item, error: itemError } = await supabase
    .from("chainthings_items")
    .select("*")
    .eq("id", itemId)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (itemError || !item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  // Look up tenant AI config
  const { data: aiIntegrations } = await supabase
    .from("chainthings_integrations")
    .select("service, config")
    .eq("tenant_id", profile.tenant_id)
    .in("service", ["zeroclaw", "openclaw"]);

  const zcIntegration = aiIntegrations?.find((i) => i.service === "zeroclaw");
  const ocIntegration = aiIntegrations?.find((i) => i.service === "openclaw");
  const activeIntegration = zcIntegration || ocIntegration;
  const aiConfig = activeIntegration?.config as Record<string, unknown> | null;
  const aiOptions: ChatCompletionOptions = {
    provider: zcIntegration ? "zeroclaw" : ocIntegration ? "openclaw" : undefined,
    token: (aiConfig?.api_token as string) || undefined,
    tenantId: profile.tenant_id,
  };

  try {
    const response = await chatCompletion(
      [
        { role: "system", content: EXTRACT_PROMPT },
        { role: "user", content: item.content || item.title || "" },
      ],
      user.id,
      aiOptions
    );

    const content = response.choices[0]?.message?.content || "{}";
    let extracted: Record<string, unknown>;
    try {
      extracted = JSON.parse(content);
    } catch {
      extracted = { raw: content };
    }

    // Update item with extracted metadata
    const newMetadata = {
      ...(item.metadata || {}),
      ...extracted,
      extractedAt: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("chainthings_items")
      .update({
        title: (extracted.title as string) || item.title,
        metadata: newMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Create memory entries from action items (deduplicated by source)
    const actionItems = extracted.actionItems as Array<{ task: string; assignee?: string }> | undefined;
    if (actionItems?.length) {
      // Remove existing task memories for this item to avoid duplicates on re-extraction
      await supabase
        .from("chainthings_memory_entries")
        .delete()
        .eq("tenant_id", profile.tenant_id)
        .eq("source_type", "item")
        .eq("source_id", itemId)
        .eq("category", "task");

      const memoryInserts = actionItems.map((ai) => ({
        tenant_id: profile.tenant_id,
        category: "task" as const,
        content: ai.assignee ? `${ai.task} (assigned to: ${ai.assignee})` : ai.task,
        importance: 7,
        source_type: "item",
        source_id: itemId,
      }));

      await supabase.from("chainthings_memory_entries").insert(memoryInserts);
    }

    return NextResponse.json({ data: { extracted: newMetadata } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
