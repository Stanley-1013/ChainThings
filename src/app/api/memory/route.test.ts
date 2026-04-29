import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELETE, GET, PATCH, POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import {
  createMockSupabaseClient,
  mockProfile,
  mockUser,
} from "@/__tests__/mocks/supabase";
import {
  createDeleteRequest,
  createGetRequest,
  createJsonRequest,
  getJsonResponse,
} from "@/__tests__/helpers";

const mockCreateClient = vi.mocked(createClient);

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

function createQueryChain(result: QueryResult) {
  const chain = {
    data: result.data,
    error: result.error,
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    single: vi.fn(() => result),
    then: vi.fn((resolve: (value: QueryResult) => unknown) => Promise.resolve(resolve(result))),
  };
  return chain;
}

function setupClient(options: {
  user?: typeof mockUser | null;
  profile?: typeof mockProfile | null;
  memoryRows?: unknown[];
  memoryError?: { message: string } | null;
  insertRow?: unknown;
  insertError?: { message: string } | null;
  patchRows?: unknown[];
  patchError?: { message: string } | null;
  deleteError?: { message: string } | null;
} = {}) {
  const client = createMockSupabaseClient({
    user: options.user === undefined ? mockUser : options.user,
  });
  const profile = options.profile === undefined ? mockProfile : options.profile;
  const profileChain = createQueryChain({ data: profile, error: null });
  const listChain = createQueryChain({
    data: options.memoryRows ?? [],
    error: options.memoryError ?? null,
  });
  const insertChain = createQueryChain({
    data: options.insertRow ?? {
      id: "mem-1",
      category: "task",
      content: "Follow up",
    },
    error: options.insertError ?? null,
  });
  const patchChain = createQueryChain({
    data: options.patchRows ?? [{ id: "mem-1", task_status: "done" }],
    error: options.patchError ?? options.deleteError ?? null,
  });

  client.from = vi.fn((table: string) => {
    if (table === "chainthings_profiles") return profileChain as never;
    if (table === "chainthings_memory_entries") return listChain as never;
    return {} as never;
  });
  listChain.insert.mockImplementation(() => insertChain);
  listChain.update.mockImplementation(() => patchChain);
  patchChain.in.mockImplementation(() => patchChain);
  patchChain.eq.mockImplementation(() => patchChain);
  patchChain.select.mockImplementation(() => patchChain);

  mockCreateClient.mockResolvedValue(client as never);
  return { client, listChain, insertChain, patchChain };
}

describe("/api/memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupClient();
  });

  it("should return 401 when unauthenticated", async () => {
    setupClient({ user: null });

    const response = await GET(createGetRequest("http://localhost/api/memory"));
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when tenant profile is missing", async () => {
    setupClient({ profile: null });

    const response = await GET(createGetRequest("http://localhost/api/memory"));
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  it("should list active memory entries and apply category filters", async () => {
    const rows = [{ id: "mem-1", category: "preference", content: "Use concise replies" }];
    const { listChain } = setupClient({ memoryRows: rows });

    const response = await GET(
      createGetRequest("http://localhost/api/memory?category=preference")
    );
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: rows });
    expect(listChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-456");
    expect(listChain.eq).toHaveBeenCalledWith("status", "active");
    expect(listChain.eq).toHaveBeenCalledWith("category", "preference");
    expect(listChain.limit).toHaveBeenCalledWith(100);
  });

  it.each(["task", "preference", "fact", "project", "summary"])(
    "should create %s memory entries",
    async (category) => {
      const { listChain, insertChain } = setupClient({
        insertRow: { id: `mem-${category}`, category, content: "Stored memory" },
      });
      const request = createJsonRequest("http://localhost/api/memory", {
        category,
        content: "Stored memory",
        importance: 8,
        dueDate: "2026-05-01T00:00:00.000Z",
      });

      const response = await POST(request);
      const body = await getJsonResponse(response);

      expect(response.status).toBe(201);
      expect(body.data).toMatchObject({ category, content: "Stored memory" });
      expect(listChain.insert).toHaveBeenCalledWith({
        tenant_id: "tenant-456",
        category,
        content: "Stored memory",
        importance: 8,
        source_type: "manual",
        due_date: "2026-05-01T00:00:00.000Z",
      });
      expect(insertChain.select).toHaveBeenCalledOnce();
    }
  );

  it("should reject missing required fields and invalid categories", async () => {
    const missingRequest = createJsonRequest("http://localhost/api/memory", {
      category: "task",
    });
    const invalidRequest = createJsonRequest("http://localhost/api/memory", {
      category: "note",
      content: "Invalid category",
    });

    const missingResponse = await POST(missingRequest);
    const invalidResponse = await POST(invalidRequest);
    const missingBody = await getJsonResponse(missingResponse);
    const invalidBody = await getJsonResponse(invalidResponse);

    expect(missingResponse.status).toBe(400);
    expect(missingBody.error).toBe("category and content are required");
    expect(invalidResponse.status).toBe(400);
    expect(invalidBody.error).toContain("task, preference, fact, project, summary");
  });

  it("should validate patch ids, task status, importance, and due date", async () => {
    const missingIdResponse = await PATCH(
      createJsonRequest("http://localhost/api/memory", { task_status: "done" })
    );
    const badStatusResponse = await PATCH(
      createJsonRequest("http://localhost/api/memory", {
        id: "mem-1",
        task_status: "blocked",
      })
    );
    const badImportanceResponse = await PATCH(
      createJsonRequest("http://localhost/api/memory", { id: "mem-1", importance: 11 })
    );
    const badDueDateResponse = await PATCH(
      createJsonRequest("http://localhost/api/memory", { id: "mem-1", due_date: "soon" })
    );

    expect(missingIdResponse.status).toBe(400);
    expect((await getJsonResponse(missingIdResponse)).error).toBe("id or ids is required");
    expect(badStatusResponse.status).toBe(400);
    expect((await getJsonResponse(badStatusResponse)).error).toContain("todo, in_progress, done");
    expect(badImportanceResponse.status).toBe(400);
    expect((await getJsonResponse(badImportanceResponse)).error).toBe("importance must be 1-10");
    expect(badDueDateResponse.status).toBe(400);
    expect((await getJsonResponse(badDueDateResponse)).error).toContain("valid ISO 8601");
  });

  it("should update active entries for the current tenant", async () => {
    const { listChain, patchChain } = setupClient({
      patchRows: [{ id: "mem-1", importance: 9 }],
    });
    const request = createJsonRequest("http://localhost/api/memory", {
      ids: ["mem-1"],
      importance: 9,
      due_date: null,
      assignee: 42,
    });

    const response = await PATCH(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: [{ id: "mem-1", importance: 9 }], updated: 1 });
    expect(listChain.update).toHaveBeenCalledWith({
      updated_at: expect.any(String),
      importance: 9,
      due_date: null,
      assignee: null,
    });
    expect(patchChain.in).toHaveBeenCalledWith("id", ["mem-1"]);
    expect(patchChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-456");
    expect(patchChain.eq).toHaveBeenCalledWith("status", "active");
  });

  it("should archive ids and clear all active entries instead of deleting rows", async () => {
    const { listChain, patchChain } = setupClient();
    const archiveRequest = createDeleteRequest("http://localhost/api/memory", {
      ids: ["mem-1", "mem-2"],
    });
    const clearAllRequest = createDeleteRequest("http://localhost/api/memory", {
      clearAll: true,
    });

    const archiveResponse = await DELETE(archiveRequest);
    const clearAllResponse = await DELETE(clearAllRequest);

    expect(archiveResponse.status).toBe(200);
    expect(await getJsonResponse(archiveResponse)).toEqual({ data: { archived: 2 } });
    expect(clearAllResponse.status).toBe(200);
    expect(await getJsonResponse(clearAllResponse)).toEqual({ data: { cleared: true } });
    expect(listChain.update).toHaveBeenCalledWith({
      status: "archived",
      updated_at: expect.any(String),
    });
    expect(patchChain.in).toHaveBeenCalledWith("id", ["mem-1", "mem-2"]);
    expect(patchChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-456");
    expect(patchChain.eq).toHaveBeenCalledWith("status", "active");
  });

  it("should propagate database errors", async () => {
    setupClient({ memoryError: { message: "memory unavailable" } });
    const listResponse = await GET(createGetRequest("http://localhost/api/memory"));

    setupClient({ insertError: { message: "insert failed" } });
    const createResponse = await POST(
      createJsonRequest("http://localhost/api/memory", {
        category: "task",
        content: "Follow up",
      })
    );

    setupClient({ patchError: { message: "update failed" } });
    const patchResponse = await PATCH(
      createJsonRequest("http://localhost/api/memory", { id: "mem-1", importance: 6 })
    );

    setupClient({ deleteError: { message: "archive failed" } });
    const deleteResponse = await DELETE(
      createDeleteRequest("http://localhost/api/memory", { id: "mem-1" })
    );

    expect(listResponse.status).toBe(500);
    expect((await getJsonResponse(listResponse)).error).toBe("memory unavailable");
    expect(createResponse.status).toBe(500);
    expect((await getJsonResponse(createResponse)).error).toBe("insert failed");
    expect(patchResponse.status).toBe(500);
    expect((await getJsonResponse(patchResponse)).error).toBe("update failed");
    expect(deleteResponse.status).toBe(500);
    expect((await getJsonResponse(deleteResponse)).error).toBe("archive failed");
  });
});
