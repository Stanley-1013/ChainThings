import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateEmbedding } from "@/lib/ai-gateway/embeddings";
import { chunkContent } from "./chunker";

const BATCH_SIZE = 10;

export async function processEmbeddingQueue(tenantId?: string): Promise<{
  processed: number;
  failed: number;
}> {
  const supabase = supabaseAdmin;
  let processed = 0;
  let failed = 0;

  // Fetch pending documents
  let query = supabase
    .from("chainthings_rag_documents")
    .select("*")
    .eq("status", "pending")
    .limit(BATCH_SIZE);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data: docs, error: fetchError } = await query;
  if (fetchError || !docs?.length) return { processed: 0, failed: 0 };

  for (const doc of docs) {
    try {
      // Claim document with compare-and-set (prevents race conditions)
      const { data: claimed } = await supabase
        .from("chainthings_rag_documents")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("id", doc.id)
        .eq("status", "pending")
        .select("id")
        .single();

      if (!claimed) continue; // Another worker claimed it

      // Fetch source content
      const sourceContent = await fetchSourceContent(supabase, doc.source_type, doc.source_id);
      if (!sourceContent) {
        await markFailed(supabase, doc.id, "Source content not found");
        failed++;
        continue;
      }

      // Chunk the content
      const chunks = chunkContent(sourceContent.title, sourceContent.content, sourceContent.metadata);
      if (chunks.length === 0) {
        await markFailed(supabase, doc.id, "No content to embed");
        failed++;
        continue;
      }

      // Delete old chunks for this document
      await supabase
        .from("chainthings_rag_chunks")
        .delete()
        .eq("document_id", doc.id);

      // Embed and insert each chunk
      for (const chunk of chunks) {
        const embedding = await generateEmbedding(chunk.content);
        await supabase.from("chainthings_rag_chunks").insert({
          tenant_id: doc.tenant_id,
          document_id: doc.id,
          chunk_index: chunk.index,
          content: chunk.content,
          embedding: JSON.stringify(embedding),
          token_count: chunk.tokenCount,
          metadata: chunk.metadata,
        });
      }

      // Mark as completed
      await supabase
        .from("chainthings_rag_documents")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", doc.id);

      processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await markFailed(supabase, doc.id, message);
      failed++;
    }
  }

  return { processed, failed };
}

async function markFailed(
  supabase: typeof supabaseAdmin,
  docId: string,
  errorMessage: string
) {
  await supabase
    .from("chainthings_rag_documents")
    .update({
      status: "failed",
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", docId);
}

async function fetchSourceContent(
  supabase: typeof supabaseAdmin,
  sourceType: string,
  sourceId: string
): Promise<{ title: string | null; content: string | null; metadata?: Record<string, unknown> } | null> {
  if (sourceType === "item") {
    const { data } = await supabase
      .from("chainthings_items")
      .select("title, content, metadata")
      .eq("id", sourceId)
      .single();
    return data;
  }

  if (sourceType === "conversation") {
    const { data: conv } = await supabase
      .from("chainthings_conversations")
      .select("title")
      .eq("id", sourceId)
      .single();

    const { data: messages } = await supabase
      .from("chainthings_messages")
      .select("role, content")
      .eq("conversation_id", sourceId)
      .order("created_at", { ascending: true })
      .limit(50);

    if (!messages?.length) return null;

    const content = messages
      .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
      .join("\n");

    return { title: conv?.title ?? null, content };
  }

  if (sourceType === "memory") {
    const { data } = await supabase
      .from("chainthings_memory_entries")
      .select("category, content")
      .eq("id", sourceId)
      .single();
    return data ? { title: data.category, content: data.content } : null;
  }

  return null;
}
