import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, DELETE } from "./route";
import { createClient } from "@/lib/supabase/server";
import { createMockSupabaseClient, mockProfile } from "@/__tests__/mocks/supabase";
import { createJsonRequest, createDeleteRequest, getJsonResponse } from "@/__tests__/helpers";

const mockCreateClient = vi.mocked(createClient);

const BASE_URL = "http://localhost:3000/api/integrations";

function setupClient(tableOverrides?: Record<string, { data: unknown; error: unknown }>) {
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

    const override = tableOverrides?.[table];
    if (override) {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => override),
            single: vi.fn(() => override),
          })),
        })),
        insert: vi.fn(() => override),
        upsert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() => override),
          })),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(() => override),
        })),
      } as never;
    }

    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
  return client;
}

describe("GET /api/integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 for unauthenticated user", async () => {
    const client = createMockSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as never);

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when profile not found", async () => {
    const client = createMockSupabaseClient({ profile: null });
    mockCreateClient.mockResolvedValue(client as never);

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  it("should return integrations list", async () => {
    const integrations = [
      { id: "int-1", service: "hedy.ai", label: "Hedy", config: {}, enabled: true },
    ];
    setupClient({
      chainthings_integrations: { data: integrations, error: null },
    });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data).toEqual(integrations);
  });

  it("should return 500 on database error", async () => {
    setupClient({
      chainthings_integrations: { data: null, error: { message: "DB error" } },
    });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("Internal server error");
  });
});

describe("POST /api/integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 for unauthenticated user", async () => {
    const client = createMockSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as never);

    const request = createJsonRequest(BASE_URL, { service: "hedy.ai" });
    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  it("should return 400 when service is missing", async () => {
    setupClient();

    const request = createJsonRequest(BASE_URL, {});
    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("service is required");
  });

  it("should upsert and return integration", async () => {
    const integration = { id: "int-1", service: "hedy.ai", label: "Hedy", enabled: true };
    setupClient({
      chainthings_integrations: { data: integration, error: null },
    });

    const request = createJsonRequest(BASE_URL, { service: "hedy.ai" });
    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data.service).toBe("hedy.ai");
  });

  it("should return 500 on upsert error", async () => {
    setupClient({
      chainthings_integrations: { data: null, error: { message: "Conflict" } },
    });

    const request = createJsonRequest(BASE_URL, { service: "hedy.ai" });
    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("Internal server error");
  });
});

describe("DELETE /api/integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 for unauthenticated user", async () => {
    const client = createMockSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as never);

    const request = createDeleteRequest(BASE_URL, { id: "int-1" });
    const response = await DELETE(request);

    expect(response.status).toBe(401);
  });

  it("should return 404 when profile not found", async () => {
    const client = createMockSupabaseClient({ profile: null });
    mockCreateClient.mockResolvedValue(client as never);

    const request = createDeleteRequest(BASE_URL, { id: "int-1" });
    const response = await DELETE(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  it("should return 400 when id is missing", async () => {
    setupClient();

    const request = createDeleteRequest(BASE_URL, {});
    const response = await DELETE(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("id is required");
  });

  it("should delete with tenant isolation and return success", async () => {
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
      if (table === "chainthings_integrations") {
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

    const request = createDeleteRequest(BASE_URL, { id: "int-1" });
    const response = await DELETE(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    // Verify tenant_id was used in the delete query
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
      if (table === "chainthings_integrations") {
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

    const request = createDeleteRequest(BASE_URL, { id: "int-1" });
    const response = await DELETE(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("Internal server error");
  });
});
