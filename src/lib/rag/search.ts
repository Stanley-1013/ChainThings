import { createClient } from "@/lib/supabase/server";

export interface SearchResult {
  chunkId: string;
  documentId: string;
  sourceType: string;
  sourceId: string;
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

export async function hybridSearch(
  queryEmbedding: number[],
  queryText: string,
  options?: {
    sourceTypes?: string[];
    limit?: number;
    mode?: "hybrid" | "semantic" | "fulltext";
    signal?: AbortSignal;
  }
): Promise<SearchResult[]> {
  const supabase = await createClient();
  const mode = options?.mode ?? "hybrid";
  const { data, error } = await supabase.rpc("chainthings_rag_hybrid_search", {
    query_embedding: queryEmbedding.length ? `[${queryEmbedding.join(",")}]` : null,
    query_text: queryText,
    p_source_types: options?.sourceTypes ?? null,
    p_limit: options?.limit ?? 5,
    p_rrf_k: 60,
    p_enable_semantic: mode !== "fulltext",
    p_enable_fulltext: mode !== "semantic",
    p_candidate_multiplier: mode === "hybrid" ? 2 : 1,
  });

  if (error) {
    throw new Error(`RAG search failed: ${error.message}`);
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    chunkId: row.chunk_id as string,
    documentId: row.document_id as string,
    sourceType: row.source_type as string,
    sourceId: row.source_id as string,
    title: row.title as string | null,
    content: row.content as string,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    score: row.rrf_score as number,
  }));
}
