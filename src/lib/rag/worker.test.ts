import { beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("@/lib/rag/worker");

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/ai-gateway/embeddings", () => ({
  generateEmbeddings: vi.fn(),
}));

import { generateEmbeddings } from "@/lib/ai-gateway/embeddings";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { processEmbeddingQueue } from "./worker";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockGenerateEmbeddings = vi.mocked(generateEmbeddings);

interface RagDoc {
  id: string;
  tenant_id: string;
  source_type: string;
  source_id: string;
}

interface SetupOptions {
  docs?: RagDoc[];
  claimedIds?: Set<string>;
  sourceContent?: Record<string, { title: string | null; content: string | null; metadata?: Record<string, unknown> } | null>;
  insertThrows?: boolean;
}

function createThenable<T extends object>(
  methods: T,
  result: unknown
): T & PromiseLike<unknown> {
  return {
    ...methods,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  } as T & PromiseLike<unknown>;
}

function setupSupabase(options: SetupOptions = {}) {
  const docs = options.docs ?? [];
  const claimedIds = options.claimedIds ?? new Set(docs.map((doc) => doc.id));
  const sourceContent = options.sourceContent ?? {};
  const insertedRows: unknown[][] = [];
  const documentUpdates: unknown[] = [];
  const limit = vi.fn();
  const tenantEq = vi.fn();
  const deleteEq = vi.fn();

  const fetchQuery = createThenable(
    {
      in: vi.fn(() => fetchQuery),
      order: vi.fn(() => fetchQuery),
      limit: vi.fn((value: number) => {
        limit(value);
        return fetchQuery;
      }),
      eq: vi.fn((column: string, value: string) => {
        tenantEq(column, value);
        return fetchQuery;
      }),
    },
    { data: docs, error: null }
  );

  mockFrom.mockImplementation((table: string) => {
    if (table === "chainthings_rag_documents") {
      return {
        select: vi.fn(() => fetchQuery),
        update: vi.fn((payload: unknown) => {
          documentUpdates.push(payload);
          const updateQuery = {
            eq: vi.fn((_column: string, id: string) => ({
              in: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(() => ({
                    data: claimedIds.has(id) ? { id } : null,
                    error: null,
                  })),
                })),
              })),
            })),
          };
          return updateQuery;
        }),
      } as never;
    }

    if (table === "chainthings_items") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((_column: string, id: string) => ({
            single: vi.fn(() => ({ data: sourceContent[id] ?? null, error: null })),
          })),
        })),
      } as never;
    }

    if (table === "chainthings_rag_chunks") {
      return {
        delete: vi.fn(() => ({
          eq: vi.fn((column: string, value: string) => {
            deleteEq(column, value);
            return { data: null, error: null };
          }),
        })),
        insert: vi.fn(async (rows: unknown[]) => {
          if (options.insertThrows) throw new Error("chunk insert failed");
          insertedRows.push(rows);
          return { data: null, error: null };
        }),
      } as never;
    }

    return {} as never;
  });

  return { deleteEq, documentUpdates, insertedRows, limit, tenantEq };
}

function doc(overrides: Partial<RagDoc> = {}): RagDoc {
  return {
    id: "doc-1",
    tenant_id: "tenant-1",
    source_type: "item",
    source_id: "item-1",
    ...overrides,
  };
}

describe("processEmbeddingQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateEmbeddings.mockResolvedValue([[0.1, 0.2]]);
  });

  it("returns zero counts when the queue is empty", async () => {
    setupSupabase({ docs: [] });

    const result = await processEmbeddingQueue("tenant-1");

    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled();
  });

  it("claims a pending row, embeds chunks, writes rag_chunks, and marks the document completed", async () => {
    const pendingDoc = doc();
    const { deleteEq, documentUpdates, insertedRows, tenantEq } = setupSupabase({
      docs: [pendingDoc],
      sourceContent: {
        "item-1": { title: "Title", content: "Body content", metadata: { source: "test" } },
      },
    });

    const result = await processEmbeddingQueue("tenant-1");

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(tenantEq).toHaveBeenCalledWith("tenant_id", "tenant-1");
    expect(deleteEq).toHaveBeenCalledWith("document_id", "doc-1");
    expect(mockGenerateEmbeddings).toHaveBeenCalledWith(["Title\n\nBody content"], {
      signal: undefined,
    });
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0][0]).toMatchObject({
      tenant_id: "tenant-1",
      document_id: "doc-1",
      chunk_index: 0,
      content: "Title\n\nBody content",
      embedding: "[0.1,0.2]",
      metadata: { source: "test" },
    });
    expect(documentUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "processing" }),
        expect.objectContaining({ status: "completed" }),
      ])
    );
  });

  it("skips a row when compare-and-set claiming returns no row", async () => {
    setupSupabase({
      docs: [doc()],
      claimedIds: new Set(),
      sourceContent: {
        "item-1": { title: "Title", content: "Body" },
      },
    });

    const result = await processEmbeddingQueue("tenant-1");

    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled();
  });

  it("marks a document failed when embedding generation throws", async () => {
    const { documentUpdates, insertedRows } = setupSupabase({
      docs: [doc()],
      sourceContent: {
        "item-1": { title: "Title", content: "Body" },
      },
    });
    mockGenerateEmbeddings.mockRejectedValue(new Error("gateway down"));

    const result = await processEmbeddingQueue("tenant-1");

    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(insertedRows).toHaveLength(0);
    expect(documentUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          error_message: "gateway down",
        }),
      ])
    );
  });

  it("processes up to the default batch size in one call", async () => {
    const docs = Array.from({ length: 10 }, (_, index) =>
      doc({ id: `doc-${index}`, source_id: `item-${index}` })
    );
    const sourceContent = Object.fromEntries(
      docs.map((row, index) => [
        row.source_id,
        { title: `Title ${index}`, content: `Body ${index}` },
      ])
    );
    const { limit } = setupSupabase({ docs, sourceContent });
    mockGenerateEmbeddings.mockResolvedValue([[0.1]]);

    const result = await processEmbeddingQueue();

    expect(limit).toHaveBeenCalledWith(10);
    expect(result).toEqual({ processed: 10, failed: 0 });
    expect(mockGenerateEmbeddings).toHaveBeenCalledTimes(10);
  });

  it("marks a document failed when writing rag_chunks throws", async () => {
    const { documentUpdates } = setupSupabase({
      docs: [doc()],
      sourceContent: {
        "item-1": { title: "Title", content: "Body" },
      },
      insertThrows: true,
    });

    const result = await processEmbeddingQueue("tenant-1");

    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(documentUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          error_message: "chunk insert failed",
        }),
      ])
    );
  });
});
