import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { hybridSearch } from "./search";

const mockCreateClient = vi.mocked(createClient);

describe("hybridSearch", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({ rpc } as never);
    rpc.mockResolvedValue({ data: [], error: null });
  });

  it("returns mapped search results from the RPC", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          chunk_id: "chunk-1",
          document_id: "doc-1",
          source_type: "item",
          source_id: "item-1",
          title: "Result title",
          content: "Result body",
          metadata: { kind: "note" },
          rrf_score: 0.75,
        },
      ],
      error: null,
    });

    const results = await hybridSearch([0.1, 0.2], "query text", {
      sourceTypes: ["item"],
      limit: 3,
    });

    expect(results).toEqual([
      {
        chunkId: "chunk-1",
        documentId: "doc-1",
        sourceType: "item",
        sourceId: "item-1",
        title: "Result title",
        content: "Result body",
        metadata: { kind: "note" },
        score: 0.75,
      },
    ]);
    expect(rpc).toHaveBeenCalledWith("chainthings_hybrid_search", {
      query_embedding: "[0.1,0.2]",
      query_text: "query text",
      p_source_types: ["item"],
      p_limit: 3,
      p_rrf_k: 60,
      p_enable_semantic: true,
      p_enable_fulltext: true,
      p_candidate_multiplier: 3,
    });
  });

  it("throws when the RPC returns an error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });

    await expect(hybridSearch([0.1], "query")).rejects.toThrow(
      "RAG search failed: database unavailable"
    );
  });

  it("passes an empty query through to the RPC", async () => {
    await hybridSearch(null, "", { mode: "fulltext" });

    expect(rpc).toHaveBeenCalledWith(
      "chainthings_hybrid_search",
      expect.objectContaining({
        query_embedding: null,
        query_text: "",
        p_enable_semantic: false,
        p_enable_fulltext: true,
      })
    );
  });

  it("omits tenant_id from the RPC arguments so RLS supplies tenant scope", async () => {
    await hybridSearch([1], "tenant scoped", { sourceTypes: ["memory"] });

    const [, args] = rpc.mock.calls[0];
    expect(args).not.toHaveProperty("tenant_id");
    expect(args).not.toHaveProperty("p_tenant_id");
  });

  it("uses semantic-only flags and similarity score fallback", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          chunk_id: "chunk-2",
          document_id: "doc-2",
          source_type: "memory",
          source_id: "memory-1",
          title: null,
          content: "Memory",
          metadata: null,
          similarity: 0.5,
        },
      ],
      error: null,
    });

    const results = await hybridSearch([0.3], "memory", { mode: "semantic" });

    expect(results[0].score).toBe(0.5);
    expect(results[0].metadata).toEqual({});
    expect(rpc).toHaveBeenCalledWith(
      "chainthings_hybrid_search",
      expect.objectContaining({
        p_enable_semantic: true,
        p_enable_fulltext: false,
        p_candidate_multiplier: 1,
      })
    );
  });
});
