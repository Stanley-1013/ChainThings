import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH, DELETE } from "./route";
import { createClient } from "@/lib/supabase/server";
import { createMockSupabaseClient, mockProfile } from "@/__tests__/mocks/supabase";
import { getJsonResponse } from "@/__tests__/helpers";

const mockCreateClient = vi.mocked(createClient);

const BASE_URL = "http://localhost:3000/api/conversations/conv-1";

function createPatchRequest(body: unknown): Request {
  return new Request(BASE_URL, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(conversationId = "conv-1") {
  return { params: Promise.resolve({ conversationId }) };
}

describe("PATCH /api/conversations/[conversationId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 for unauthenticated user", async () => {
    const client = createMockSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as never);

    const request = createPatchRequest({ title: "New title" });
    const response = await PATCH(request, makeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 400 for invalid JSON", async () => {
    const client = createMockSupabaseClient();
    mockCreateClient.mockResolvedValue(client as never);

    const request = new Request(BASE_URL, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const response = await PATCH(request, makeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid JSON");
  });

  it("should return 400 when title is empty", async () => {
    const client = createMockSupabaseClient();
    mockCreateClient.mockResolvedValue(client as never);

    const request = createPatchRequest({ title: "" });
    const response = await PATCH(request, makeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toContain("title");
  });

  it("should return 400 when title exceeds 200 chars", async () => {
    const client = createMockSupabaseClient();
    mockCreateClient.mockResolvedValue(client as never);

    const request = createPatchRequest({ title: "x".repeat(201) });
    const response = await PATCH(request, makeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toContain("200");
  });

  it("should return 404 when conversation not found", async () => {
    const client = createMockSupabaseClient();
    client.from = vi.fn((table: string) => {
      if (table === "chainthings_profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => ({ data: mockProfile, error: null })),
            })),
          })),
        } as never;
      }
      if (table === "chainthings_conversations") {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  maybeSingle: vi.fn(() => ({ data: null, error: null })),
                })),
              })),
            })),
          })),
        } as never;
      }
      return {} as never;
    });
    mockCreateClient.mockResolvedValue(client as never);

    const request = createPatchRequest({ title: "New title" });
    const response = await PATCH(request, makeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Conversation not found");
  });

  it("should rename conversation successfully", async () => {
    const updated = { id: "conv-1", title: "Renamed", tenant_id: mockProfile.tenant_id };
    const client = createMockSupabaseClient();
    client.from = vi.fn((table: string) => {
      if (table === "chainthings_profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => ({ data: mockProfile, error: null })),
            })),
          })),
        } as never;
      }
      if (table === "chainthings_conversations") {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  maybeSingle: vi.fn(() => ({ data: updated, error: null })),
                })),
              })),
            })),
          })),
        } as never;
      }
      return {} as never;
    });
    mockCreateClient.mockResolvedValue(client as never);

    const request = createPatchRequest({ title: "  Renamed  " });
    const response = await PATCH(request, makeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data.title).toBe("Renamed");
  });
});

describe("DELETE /api/conversations/[conversationId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 for unauthenticated user", async () => {
    const client = createMockSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as never);

    const request = new Request(BASE_URL, { method: "DELETE" });
    const response = await DELETE(request, makeParams());

    expect(response.status).toBe(401);
  });

  it("should return 404 when conversation not found", async () => {
    const client = createMockSupabaseClient();
    client.from = vi.fn((table: string) => {
      if (table === "chainthings_profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => ({ data: mockProfile, error: null })),
            })),
          })),
        } as never;
      }
      if (table === "chainthings_conversations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => ({ data: null, error: null })),
              })),
            })),
          })),
        } as never;
      }
      return {} as never;
    });
    mockCreateClient.mockResolvedValue(client as never);

    const request = new Request(BASE_URL, { method: "DELETE" });
    const response = await DELETE(request, makeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Conversation not found");
  });

  it("should delete conversation and return 204", async () => {
    const deleteEq = vi.fn(() => ({ error: null }));
    const client = createMockSupabaseClient();
    client.from = vi.fn((table: string) => {
      if (table === "chainthings_profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => ({ data: mockProfile, error: null })),
            })),
          })),
        } as never;
      }
      if (table === "chainthings_conversations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => ({ data: { id: "conv-1" }, error: null })),
              })),
            })),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: deleteEq,
            })),
          })),
        } as never;
      }
      return {} as never;
    });
    mockCreateClient.mockResolvedValue(client as never);

    const request = new Request(BASE_URL, { method: "DELETE" });
    const response = await DELETE(request, makeParams());

    expect(response.status).toBe(204);
    expect(deleteEq).toHaveBeenCalledWith("tenant_id", mockProfile.tenant_id);
  });
});
