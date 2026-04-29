import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { chatCompletion } from "@/lib/ai-gateway";
import {
  createMockSupabaseClient,
  mockProfile,
  mockUser,
} from "@/__tests__/mocks/supabase";
import { createJsonRequest, getJsonResponse } from "@/__tests__/helpers";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

const mockCreateClient = vi.mocked(createClient);
const mockSupabaseAdminFrom = vi.mocked(supabaseAdmin.from);
const mockChatCompletion = vi.mocked(chatCompletion);

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
    update: vi.fn((_payload?: unknown) => chain),
    delete: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    single: vi.fn(() => result),
    then: vi.fn((resolve: (value: QueryResult) => unknown) => Promise.resolve(resolve(result))),
  };
  return chain;
}

function setupClient(options: {
  user?: typeof mockUser | null;
  profile?: typeof mockProfile | null;
  integrations?: Array<{ service: string; config: Record<string, unknown> }>;
} = {}) {
  const client = createMockSupabaseClient({
    user: options.user === undefined ? mockUser : options.user,
  });
  const profile = options.profile === undefined ? mockProfile : options.profile;
  const profileChain = createQueryChain({ data: profile, error: null });
  const integrationsChain = createQueryChain({
    data: options.integrations ?? [
      { service: "zeroclaw", config: { api_token: "tenant-zc-token" } },
    ],
    error: null,
  });

  client.from = vi.fn((table: string) => {
    if (table === "chainthings_profiles") return profileChain as never;
    if (table === "chainthings_integrations") return integrationsChain as never;
    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
  return { integrationsChain };
}

function setupAdmin(options: {
  item?: Record<string, unknown> | null;
  updateError?: { message: string } | null;
  insertError?: { message: string } | null;
} = {}) {
  const item = options.item === undefined
    ? {
        id: "item-1",
        tenant_id: "tenant-456",
        title: "Original title",
        content: "Discuss launch tasks",
        metadata: { source: "manual" },
      }
    : options.item;
  const itemSelectChain = createQueryChain({ data: item, error: null });
  const itemUpdateChain = createQueryChain({ data: null, error: options.updateError ?? null });
  const memoryDeleteChain = createQueryChain({ data: null, error: null });
  const memoryInsertChain = createQueryChain({ data: null, error: options.insertError ?? null });

  mockSupabaseAdminFrom.mockImplementation((table: string) => {
    if (table === "chainthings_items") {
      return {
        select: itemSelectChain.select,
        update: vi.fn((payload: unknown) => {
          itemUpdateChain.update(payload);
          return itemUpdateChain;
        }),
      } as never;
    }

    if (table === "chainthings_memory_entries") {
      return {
        delete: vi.fn(() => memoryDeleteChain),
        insert: memoryInsertChain.insert,
      } as never;
    }

    return {} as never;
  });

  return { itemSelectChain, itemUpdateChain, memoryDeleteChain, memoryInsertChain };
}

function setupChat(content: string) {
  mockChatCompletion.mockResolvedValue({
    choices: [{ message: { content } }],
  } as never);
}

describe("POST /api/items/extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setupClient();
    setupAdmin();
    setupChat(JSON.stringify({
      title: "Launch plan",
      keyPoints: ["Timeline agreed"],
      actionItems: [{ task: "Send recap", assignee: "Ava" }],
      summary: "The team aligned on launch.",
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return 401 for unauthenticated users", async () => {
    setupClient({ user: null });
    const request = createJsonRequest("http://localhost/api/items/extract", {
      itemId: "item-1",
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 400 when itemId is missing", async () => {
    const response = await POST(createJsonRequest("http://localhost/api/items/extract", {}));
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("itemId is required");
  });

  it("should return 404 when tenant profile is missing", async () => {
    setupClient({ profile: null });
    const request = createJsonRequest("http://localhost/api/items/extract", {
      itemId: "item-1",
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  it("should extract metadata with tenant AI configuration and create task memory", async () => {
    const { integrationsChain } = setupClient({
      integrations: [
        { service: "openclaw", config: { api_token: "open-token" } },
        { service: "zeroclaw", config: { api_token: "zero-token" } },
      ],
    });
    const { itemSelectChain, itemUpdateChain, memoryDeleteChain, memoryInsertChain } = setupAdmin();
    const request = createJsonRequest("http://localhost/api/items/extract", {
      itemId: "item-1",
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data.extracted).toMatchObject({
      source: "manual",
      title: "Launch plan",
      keyPoints: ["Timeline agreed"],
      actionItems: [{ task: "Send recap", assignee: "Ava" }],
      summary: "The team aligned on launch.",
      extractedAt: expect.any(String),
    });
    expect(integrationsChain.in).toHaveBeenCalledWith("service", ["zeroclaw", "openclaw"]);
    expect(itemSelectChain.eq).toHaveBeenCalledWith("id", "item-1");
    expect(itemSelectChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-456");
    expect(mockChatCompletion).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
      { provider: "zeroclaw", token: "zero-token", tenantId: "tenant-456" }
    );
    expect(itemUpdateChain.update).toHaveBeenCalledWith({
      title: "Launch plan",
      metadata: expect.objectContaining({ title: "Launch plan" }),
      updated_at: expect.any(String),
    });
    expect(memoryDeleteChain.eq).toHaveBeenCalledWith("source_id", "item-1");
    expect(memoryInsertChain.insert).toHaveBeenCalledWith([
      {
        tenant_id: "tenant-456",
        category: "task",
        content: "Send recap (assigned to: Ava)",
        importance: 7,
        source_type: "item",
        source_id: "item-1",
      },
    ]);
  });

  it("should return 404 when the item is not found", async () => {
    setupAdmin({ item: null });
    const request = createJsonRequest("http://localhost/api/items/extract", {
      itemId: "missing",
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Item not found");
  });

  it("should preserve malformed AI JSON as raw metadata", async () => {
    setupChat("not-json");
    const { memoryInsertChain } = setupAdmin();
    const request = createJsonRequest("http://localhost/api/items/extract", {
      itemId: "item-1",
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data.extracted).toMatchObject({
      source: "manual",
      raw: "not-json",
      extractedAt: expect.any(String),
    });
    expect(memoryInsertChain.insert).not.toHaveBeenCalled();
  });

  it("should handle an empty AI action items list without writing task memory", async () => {
    setupChat(JSON.stringify({
      title: "No tasks",
      keyPoints: [],
      actionItems: [],
      summary: "Nothing actionable.",
    }));
    const { memoryInsertChain } = setupAdmin();
    const request = createJsonRequest("http://localhost/api/items/extract", {
      itemId: "item-1",
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data.extracted).toMatchObject({
      title: "No tasks",
      actionItems: [],
    });
    expect(memoryInsertChain.insert).not.toHaveBeenCalled();
  });

  it("should map AI failures to 502", async () => {
    mockChatCompletion.mockRejectedValue(new Error("gateway unavailable"));
    const request = createJsonRequest("http://localhost/api/items/extract", {
      itemId: "item-1",
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(502);
    expect(body.error).toBe("gateway unavailable");
  });
});
