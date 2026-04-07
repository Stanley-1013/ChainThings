import { chatCompletion, type ChatCompletionOptions } from "@/lib/ai-gateway";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface MemoryExtraction {
  category: "task" | "preference" | "fact" | "project";
  content: string;
  importance: number;
  dueDate?: string | null;
}

const EXTRACTION_TIMEOUT_MS = 15_000;
const EXTRACTION_MAX_TOKENS = 500;

const EXTRACTION_PROMPT = `Analyze the following conversation and extract noteworthy information worth remembering. Only extract genuinely useful facts, tasks, or preferences — NOT casual greetings or trivial exchanges.

For each item, return a JSON array with objects containing:
- "category": one of "task", "preference", "fact", "project"
- "content": concise description in the user's language
- "importance": 1-10 (10 = critical)
- "dueDate": ISO 8601 date string if a deadline is mentioned, otherwise null

If nothing worth remembering, return an empty array: []

Respond ONLY with the JSON array, no explanation.`;

export function shouldExtractMemory(message: string, tool: string | null): boolean {
  if (tool === "n8n") return false;
  const t = message.trim();
  if (t.length < 20) return false;
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|yo|好|謝|嗨)\b/i.test(t.toLowerCase())) return false;
  return true;
}

export async function extractAndSaveMemories(
  userMessage: string,
  assistantResponse: string,
  tenantId: string,
  aiOptions?: ChatCompletionOptions
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);

  try {
    const response = await Promise.race([
      chatCompletion(
        [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: `User: ${userMessage}\n\nAssistant: ${assistantResponse}` },
        ],
        undefined,
        { ...aiOptions, model: aiOptions?.model }
      ),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("extraction timeout")), { once: true });
      }),
    ]);

    const raw = response.choices[0]?.message?.content || "[]";
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const extractions: MemoryExtraction[] = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(extractions) || extractions.length === 0) return;

    const validCategories = ["task", "preference", "fact", "project"];
    const valid = extractions.filter(
      (e) =>
        validCategories.includes(e.category) &&
        typeof e.content === "string" &&
        e.content.length > 0 &&
        typeof e.importance === "number" &&
        e.importance >= 1 &&
        e.importance <= 10
    );

    if (valid.length === 0) return;

    // Dedup: check existing memories
    const { data: existing } = await supabaseAdmin
      .from("chainthings_memory_entries")
      .select("content, category")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .limit(20);

    const existingNorm = new Set(
      (existing ?? []).map((m) => normalizeForDedup(m.content))
    );

    // Dedup against existing + within current batch
    const toInsert: MemoryExtraction[] = [];
    const seen = new Set(existingNorm);
    for (const e of valid) {
      const norm = normalizeForDedup(e.content);
      if (seen.has(norm)) continue;
      seen.add(norm);
      toInsert.push(e);
    }

    if (toInsert.length === 0) return;

    await supabaseAdmin.from("chainthings_memory_entries").insert(
      toInsert.map((e) => ({
        tenant_id: tenantId,
        category: e.category,
        content: e.content,
        importance: e.importance,
        source_type: "ai_extracted",
        due_date: e.dueDate && isValidISODate(e.dueDate) ? e.dueDate : null,
      }))
    );

  } catch {
    // Memory extraction failure is non-fatal
  } finally {
    clearTimeout(timer);
  }
}

function normalizeForDedup(text: string): string {
  return text.trim().toLowerCase().replace(/[^\w\s\u4e00-\u9fff]/g, "");
}

function isValidISODate(s: string): boolean {
  const d = new Date(s);
  return !isNaN(d.getTime());
}
