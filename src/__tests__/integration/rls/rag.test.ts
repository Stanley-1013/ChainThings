import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import {
  fixtureTenant,
  asUser,
  asAdmin,
  asAnon,
  insertOrThrow,
  fakeVector1024,
} from "../helpers/fixtures";

// RLS contract for RAG data:
//   policy "Tenant isolation for rag_documents" — for all using (tenant_id = chainthings_current_tenant_id())
//   policy "Tenant isolation for rag_chunks"    — for all using (tenant_id = chainthings_current_tenant_id())
//
// RPC `chainthings_hybrid_search` is SECURITY INVOKER:
//   - derives v_tenant_id via chainthings_current_tenant_id() (reads JWT claims)
//   - raises 'Unauthorized: no tenant context' when v_tenant_id IS NULL
//   - filters all queries hard-coded to v_tenant_id — cross-tenant data never surfaces

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert a rag_document via asAdmin() to bypass RLS, return its id. */
async function insertDoc(
  tenantId: string,
  sourceId: string,
  title: string,
  status: "pending" | "completed" = "completed",
): Promise<string> {
  const { data, error } = await asAdmin()
    .from("chainthings_rag_documents")
    .insert({
      tenant_id: tenantId,
      source_type: "memory",
      source_id: sourceId,
      title,
      content_hash: randomUUID().replace(/-/g, ""), // 32 hex chars — good enough
      status,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertDoc failed: ${error?.message}`);
  return data.id;
}

/** Insert a rag_chunk via asAdmin() to bypass RLS, return its id. */
async function insertChunk(
  tenantId: string,
  documentId: string,
  content: string,
  chunkIndex = 0,
  embedding: number[] = fakeVector1024(),
): Promise<string> {
  const { data, error } = await asAdmin()
    .from("chainthings_rag_chunks")
    .insert({
      tenant_id: tenantId,
      document_id: documentId,
      chunk_index: chunkIndex,
      content,
      embedding,
      // content_tsv is a generated column — must NOT be supplied
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertChunk failed: ${error?.message}`);
  return data.id;
}

// ---------------------------------------------------------------------------
// A. Table-level RLS — chainthings_rag_documents
// ---------------------------------------------------------------------------

describe("RLS: chainthings_rag_documents", () => {

  it("same-tenant: insert + read own document works", async () => {
    const t = await fixtureTenant("doc-a");
    const sourceId = randomUUID();

    const { data, error } = await asUser(t)
      .from("chainthings_rag_documents")
      .insert({
        tenant_id: t.tenantId,
        source_type: "memory",
        source_id: sourceId,
        title: "My Doc",
        content_hash: "abc123",
        status: "pending",
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.title).toBe("My Doc");
    expect(data?.tenant_id).toBe(t.tenantId);
  });

  it("cross-tenant SELECT: tenant A cannot see tenant B's documents", async () => {
    const a = await fixtureTenant("doc-a");
    const b = await fixtureTenant("doc-b");

    // B inserts a document (via admin to avoid cross-tenant write)
    await insertDoc(b.tenantId, randomUUID(), "B's secret document");

    const { data: aSeen } = await asUser(a)
      .from("chainthings_rag_documents")
      .select("id, title");
    expect(aSeen).toEqual([]);
  });

  it("cross-tenant INSERT: tenant A cannot insert with tenant B's id", async () => {
    const a = await fixtureTenant("doc-a");
    const b = await fixtureTenant("doc-b");

    const { data, error } = await asUser(a)
      .from("chainthings_rag_documents")
      .insert({
        tenant_id: b.tenantId, // spoofed
        source_type: "memory",
        source_id: randomUUID(),
        title: "spoof",
        content_hash: "deadbeef",
        status: "pending",
      })
      .select();

    // RLS either errors or returns an empty result (row hidden from caller)
    expect(error || data?.length === 0).toBeTruthy();
  });

  it("cross-tenant UPDATE: tenant A cannot modify tenant B's document", async () => {
    const a = await fixtureTenant("doc-a");
    const b = await fixtureTenant("doc-b");

    const docId = await insertDoc(b.tenantId, randomUUID(), "original title");

    const { data: updated } = await asUser(a)
      .from("chainthings_rag_documents")
      .update({ title: "hijacked" })
      .eq("id", docId)
      .select();
    expect(updated).toEqual([]); // RLS makes update a no-op

    const { data: stillB } = await asAdmin()
      .from("chainthings_rag_documents")
      .select("title")
      .eq("id", docId)
      .single();
    expect(stillB?.title).toBe("original title");
  });

  it("cross-tenant DELETE: tenant A cannot delete tenant B's document", async () => {
    const a = await fixtureTenant("doc-a");
    const b = await fixtureTenant("doc-b");

    const docId = await insertDoc(b.tenantId, randomUUID(), "keep me");

    await asUser(a).from("chainthings_rag_documents").delete().eq("id", docId);

    const { data: stillThere } = await asAdmin()
      .from("chainthings_rag_documents")
      .select("id")
      .eq("id", docId);
    expect(stillThere).toHaveLength(1);
  });

  it("anon: cannot read rag_documents (RLS hides all rows)", async () => {
    // Seed a document via a real tenant so the table is non-empty.
    const t = await fixtureTenant("doc-anon");
    await insertDoc(t.tenantId, randomUUID(), "anon test doc");

    const { data } = await asAnon()
      .from("chainthings_rag_documents")
      .select("id");
    // RLS policy requires an authenticated tenant context; anon has none,
    // so chainthings_current_tenant_id() returns NULL and the policy
    // evaluates to false for every row.
    expect(data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B. Table-level RLS — chainthings_rag_chunks
// ---------------------------------------------------------------------------

describe("RLS: chainthings_rag_chunks", () => {

  it("same-tenant: insert + read own chunk works", async () => {
    const t = await fixtureTenant("chunk-a");
    // Create parent document first (via user client — own tenant)
    const sourceId = randomUUID();
    const { data: doc, error: docErr } = await asUser(t)
      .from("chainthings_rag_documents")
      .insert({
        tenant_id: t.tenantId,
        source_type: "memory",
        source_id: sourceId,
        title: "Parent Doc",
        content_hash: "aabbcc",
        status: "completed",
      })
      .select("id")
      .single();
    expect(docErr).toBeNull();

    const { data: chunk, error: chunkErr } = await asUser(t)
      .from("chainthings_rag_chunks")
      .insert({
        tenant_id: t.tenantId,
        document_id: doc!.id,
        chunk_index: 0,
        content: "hello world",
        embedding: fakeVector1024(0.5),
      })
      .select("id, content, tenant_id")
      .single();

    expect(chunkErr).toBeNull();
    expect(chunk?.content).toBe("hello world");
    expect(chunk?.tenant_id).toBe(t.tenantId);
  });

  it("cross-tenant SELECT: tenant A cannot see tenant B's chunks", async () => {
    const a = await fixtureTenant("chunk-a");
    const b = await fixtureTenant("chunk-b");

    const docId = await insertDoc(b.tenantId, randomUUID(), "B doc");
    await insertChunk(b.tenantId, docId, "secret chunk content");

    const { data: aSeen } = await asUser(a)
      .from("chainthings_rag_chunks")
      .select("id, content");
    expect(aSeen).toEqual([]);
  });

  it("cross-tenant INSERT: tenant A cannot insert chunk with tenant B's id", async () => {
    const a = await fixtureTenant("chunk-a");
    const b = await fixtureTenant("chunk-b");

    // B's document exists (admin bypass so it actually gets created)
    const docId = await insertDoc(b.tenantId, randomUUID(), "B doc");

    const { data, error } = await asUser(a)
      .from("chainthings_rag_chunks")
      .insert({
        tenant_id: b.tenantId, // spoofed
        document_id: docId,
        chunk_index: 0,
        content: "spoof content",
        embedding: fakeVector1024(),
      })
      .select();

    expect(error || data?.length === 0).toBeTruthy();
  });

  it("cross-tenant UPDATE: tenant A cannot modify tenant B's chunk", async () => {
    const a = await fixtureTenant("chunk-a");
    const b = await fixtureTenant("chunk-b");

    const docId = await insertDoc(b.tenantId, randomUUID(), "B doc");
    const chunkId = await insertChunk(b.tenantId, docId, "original content");

    const { data: updated } = await asUser(a)
      .from("chainthings_rag_chunks")
      .update({ content: "hijacked" })
      .eq("id", chunkId)
      .select();
    expect(updated).toEqual([]);

    const { data: stillB } = await asAdmin()
      .from("chainthings_rag_chunks")
      .select("content")
      .eq("id", chunkId)
      .single();
    expect(stillB?.content).toBe("original content");
  });

  it("cross-tenant DELETE: tenant A cannot delete tenant B's chunk", async () => {
    const a = await fixtureTenant("chunk-a");
    const b = await fixtureTenant("chunk-b");

    const docId = await insertDoc(b.tenantId, randomUUID(), "B doc");
    const chunkId = await insertChunk(b.tenantId, docId, "keep this chunk");

    await asUser(a).from("chainthings_rag_chunks").delete().eq("id", chunkId);

    const { data: stillThere } = await asAdmin()
      .from("chainthings_rag_chunks")
      .select("id")
      .eq("id", chunkId);
    expect(stillThere).toHaveLength(1);
  });

  it("anon: cannot read rag_chunks (RLS hides all rows)", async () => {
    // Seed a chunk via a real tenant so the table is non-empty.
    const t = await fixtureTenant("chunk-anon");
    const docId = await insertDoc(t.tenantId, randomUUID(), "anon chunk test doc");
    await insertChunk(t.tenantId, docId, "anon test chunk content");

    const { data } = await asAnon()
      .from("chainthings_rag_chunks")
      .select("id");
    // RLS policy requires an authenticated tenant context; anon has none,
    // so chainthings_current_tenant_id() returns NULL and the policy
    // evaluates to false for every row.
    expect(data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C. chainthings_hybrid_search RPC — security-critical tenant scoping
// ---------------------------------------------------------------------------

describe("RPC: chainthings_hybrid_search — tenant scoping", () => {

  it("positive: RPC returns only the calling tenant's chunks (not cross-tenant)", async () => {
    // Both tenants share the same query embedding and similar text so both
    // would rank in an embedding search — only A's chunk must be returned.
    const a = await fixtureTenant("rpc-a");
    const b = await fixtureTenant("rpc-b");

    const sharedEmbedding = fakeVector1024(0.1);

    // Tenant A: doc + chunk
    const docA = await insertDoc(a.tenantId, randomUUID(), "Doc A");
    const chunkAId = await insertChunk(
      a.tenantId,
      docA,
      "the quick brown fox jumps over the lazy dog",
      0,
      sharedEmbedding,
    );

    // Tenant B: doc + chunk (same text/embedding — would rank equally without isolation)
    const docB = await insertDoc(b.tenantId, randomUUID(), "Doc B");
    const chunkBId = await insertChunk(
      b.tenantId,
      docB,
      "the quick brown fox jumps over the lazy dog",
      0,
      sharedEmbedding,
    );

    // Call as tenant A
    const { data, error } = await asUser(a).rpc("chainthings_hybrid_search", {
      query_embedding: sharedEmbedding,
      query_text: "the quick brown fox",
      p_source_types: null,
      p_limit: 10,
    });

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);

    const returnedIds = (data as Array<{ chunk_id: string }>).map(
      (r) => r.chunk_id,
    );
    expect(returnedIds).toContain(chunkAId);
    expect(returnedIds).not.toContain(chunkBId);
  });

  it("negative (null tenant): anon call raises Unauthorized error", async () => {
    // The RPC's SECURITY INVOKER path calls chainthings_current_tenant_id().
    // When no JWT is present, that returns NULL and the function raises:
    //   'Unauthorized: no tenant context'
    const { data, error } = await asAnon().rpc("chainthings_hybrid_search", {
      query_embedding: fakeVector1024(),
      query_text: "anything",
      p_source_types: null,
      p_limit: 5,
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    // Accept either the exact exception message or any Unauthorized/403 variant
    // that the PostgREST error envelope might surface.
    const msg = (error?.message ?? "") + (error?.code ?? "");
    expect(
      msg.toLowerCase().includes("unauthorized") ||
        msg.toLowerCase().includes("no tenant context") ||
        msg.toLowerCase().includes("403"),
    ).toBe(true);
  });

  it("full-text only: A's keyword query returns A's chunk via fulltext branch", async () => {
    // Proves the full-text branch works in isolation when p_enable_semantic=false.
    // Without this test the semantic branch (cosine sim always 1.0 with fakeVector1024)
    // can silently satisfy the positive assertion even if full-text is broken.
    const a = await fixtureTenant("rpc-fto-a");
    const embeddingA = fakeVector1024(0.42);

    const docA = await insertDoc(a.tenantId, randomUUID(), "Doc A fulltext only");
    const chunkAId = await insertChunk(
      a.tenantId,
      docA,
      "specific keyword 12345 alpha unique phrase",
      0,
      embeddingA,
    );

    const { data, error } = await asUser(a).rpc("chainthings_hybrid_search", {
      query_embedding: embeddingA,
      query_text: "specific keyword 12345",
      p_source_types: null,
      p_limit: 5,
      p_enable_semantic: false,
      p_enable_fulltext: true,
    });

    expect(error).toBeNull();
    const ids = (data as Array<{ chunk_id: string }>).map((r) => r.chunk_id);
    expect(ids).toContain(chunkAId);
  });

  it("cross-tenant data exclusion via full-text filter: A's keyword query excludes B's data", async () => {
    // Uses distinct keywords so full-text ranking drives the result.
    // A's chunk contains a unique phrase; B's chunk is about something unrelated.
    // When A queries with A's keyword, only A's chunk is returned.
    // When B queries with A's keyword, result is empty (B has no matching content).
    const a = await fixtureTenant("rpc-ft-a");
    const b = await fixtureTenant("rpc-ft-b");

    // Give embeddings deliberately different seeds so vector search agrees
    const embeddingA = fakeVector1024(0.11);
    const embeddingB = fakeVector1024(0.99);

    const docA = await insertDoc(a.tenantId, randomUUID(), "Doc A keyword test");
    const chunkAId = await insertChunk(
      a.tenantId,
      docA,
      "specific keyword 12345 alpha unique phrase",
      0,
      embeddingA,
    );

    const docB = await insertDoc(b.tenantId, randomUUID(), "Doc B keyword test");
    await insertChunk(
      b.tenantId,
      docB,
      "completely different content about bananas and oranges",
      0,
      embeddingB,
    );

    // A queries with A's unique keyword — should get A's chunk
    const { data: dataA, error: errorA } = await asUser(a).rpc(
      "chainthings_hybrid_search",
      {
        query_embedding: embeddingA,
        query_text: "specific keyword 12345",
        p_source_types: null,
        p_limit: 5,
      },
    );
    expect(errorA).toBeNull();
    const idsA = (dataA as Array<{ chunk_id: string }>).map((r) => r.chunk_id);
    expect(idsA).toContain(chunkAId);

    // B queries with A's unique keyword — should return empty (B's content doesn't match).
    // Disable semantic branch: fakeVector1024 returns a constant vector, so cosine
    // similarity is always 1.0 and the semantic branch would hit on any chunk. We
    // want this assertion to test full-text exclusion specifically.
    const { data: dataB, error: errorB } = await asUser(b).rpc(
      "chainthings_hybrid_search",
      {
        query_embedding: embeddingA,
        query_text: "specific keyword 12345",
        p_source_types: null,
        p_limit: 5,
        p_enable_semantic: false,
        p_enable_fulltext: true,
      },
    );
    expect(errorB).toBeNull();
    // B's data is tenant-scoped; A's chunk is invisible to B. And B's own chunk
    // doesn't full-text match "specific keyword".
    const idsB = (dataB as Array<{ chunk_id: string }>).map((r) => r.chunk_id);
    expect(idsB).not.toContain(chunkAId);
    expect(idsB).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// D. Child-FK cross-tenant isolation — rag_chunks.document_id
// ---------------------------------------------------------------------------

describe("RLS: rag_chunks — parent-child FK isolation", () => {

  it("cross-tenant FK: A cannot insert chunk referencing B's document_id", async () => {
    // The strengthened WITH CHECK policy on rag_chunks now requires:
    //   EXISTS (SELECT 1 FROM chainthings_rag_documents d
    //           WHERE d.id = document_id AND d.tenant_id = chainthings_current_tenant_id())
    // Since bDoc belongs to tenant B, not A, the insert must be blocked.
    const a = await fixtureTenant("fk-attack-a");
    const b = await fixtureTenant("fk-attack-b");

    // B seeds a document via admin — A should not be able to enumerate it.
    const bDoc = await insertOrThrow<{ id: string }>(
      asAdmin(),
      "chainthings_rag_documents",
      {
        tenant_id: b.tenantId,
        source_type: "memory",
        source_id: randomUUID(),
        title: "B secret doc",
        content_hash: randomUUID().replace(/-/g, ""),
        status: "completed",
      },
    );

    // A tries to insert a chunk with its own tenant_id but B's document_id.
    const { data, error } = await asUser(a)
      .from("chainthings_rag_chunks")
      .insert({
        tenant_id: a.tenantId,        // A's own tenant
        document_id: bDoc.id,         // B's document — now blocked by WITH CHECK
        chunk_index: 0,
        content: "cross-tenant FK attack payload",
        embedding: fakeVector1024(0.77),
      })
      .select();

    // The insert must be blocked (error) or the row hidden by RLS (empty data).
    expect(error || data?.length === 0).toBeTruthy();
  });
});
