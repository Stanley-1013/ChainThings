import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, DELETE } from "./route";
import { createClient } from "@/lib/supabase/server";
import { createMockSupabaseClient, mockProfile } from "@/__tests__/mocks/supabase";
import { getJsonResponse } from "@/__tests__/helpers";

const mockCreateClient = vi.mocked(createClient);

describe("GET /api/items/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 for unauthenticated user", async () => {
    const client = createMockSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as never);

    const request = new Request("http://localhost:3000/api/items/item-1");
    const response = await GET(request, { params: Promise.resolve({ id: "item-1" }) });
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when profile not found", async () => {
    const client = createMockSupabaseClient({ profile: null });
    mockCreateClient.mockResolvedValue(client as never);

    const request = new Request("http://localhost:3000/api/items/item-1");
    const response = await GET(request, { params: Promise.resolve({ id: "item-1" }) });
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  it("should return item detail", async () => {
    const item = { id: "item-1", type: "meeting_notes", title: "Meeting 1", tenant_id: mockProfile.tenant_id };
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
      if (table === "chainthings_items") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => ({ data: item, error: null })),
              })),
            })),
          })),
        } as never;
      }
      return {} as never;
    });

    mockCreateClient.mockResolvedValue(client as never);

    const request = new Request("http://localhost:3000/api/items/item-1");
    const response = await GET(request, { params: Promise.resolve({ id: "item-1" }) });
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data).toEqual(item);
  });

  it("should return 500 on database error", async () => {
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
      if (table === "chainthings_items") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => ({ data: null, error: { message: "DB error" } })),
              })),
            })),
          })),
        } as never;
      }
      return {} as never;
    });

    mockCreateClient.mockResolvedValue(client as never);

    const request = new Request("http://localhost:3000/api/items/item-1");
    const response = await GET(request, { params: Promise.resolve({ id: "item-1" }) });
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("DB error");
  });
});

describe("DELETE /api/items/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 for unauthenticated user", async () => {
    const client = createMockSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as never);

    const request = new Request("http://localhost:3000/api/items/item-1", { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ id: "item-1" }) });

    expect(response.status).toBe(401);
  });

  it("should delete item with tenant isolation", async () => {
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
      if (table === "chainthings_items") {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn((field: string) => {
              if (field === "id") {
                return { eq: deleteEq };
              }
              return { error: null };
            }),
          })),
        } as never;
      }
      return {} as never;
    });

    mockCreateClient.mockResolvedValue(client as never);

    const request = new Request("http://localhost:3000/api/items/item-1", { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ id: "item-1" }) });
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(deleteEq).toHaveBeenCalledWith("tenant_id", mockProfile.tenant_id);
  });

  it("should return 500 on delete error", async () => {
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
      if (table === "chainthings_items") {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({ error: { message: "FK violation" } })),
            })),
          })),
        } as never;
      }
      return {} as never;
    });

    mockCreateClient.mockResolvedValue(client as never);

    const request = new Request("http://localhost:3000/api/items/item-1", { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ id: "item-1" }) });
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("FK violation");
  });
});
