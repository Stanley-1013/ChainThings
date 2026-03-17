import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PATCH } from "./route";
import { createClient } from "@/lib/supabase/server";
import { createMockSupabaseClient, mockUser, mockProfile } from "@/__tests__/mocks/supabase";
import { getJsonResponse } from "@/__tests__/helpers";

const mockCreateClient = vi.mocked(createClient);

const BASE_URL = "http://localhost:3000/api/profile";

function createPatchRequest(body: unknown): Request {
  return new Request(BASE_URL, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createInvalidJsonRequest(): Request {
  return new Request(BASE_URL, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: "not json",
  });
}

describe("GET /api/profile", () => {
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

  it("should return profile with email", async () => {
    const profileData = { id: mockUser.id, display_name: "Test User", tenant_id: mockProfile.tenant_id };
    const client = createMockSupabaseClient();
    client.from = vi.fn((table: string) => {
      if (table === "chainthings_profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => ({ data: profileData, error: null })),
            })),
          })),
        } as never;
      }
      return {} as never;
    });
    mockCreateClient.mockResolvedValue(client as never);

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data.email).toBe(mockUser.email);
    expect(body.data.display_name).toBe("Test User");
    expect(body.data.tenant_id).toBe(mockProfile.tenant_id);
  });
});

describe("PATCH /api/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 for unauthenticated user", async () => {
    const client = createMockSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as never);

    const request = createPatchRequest({ display_name: "New Name" });
    const response = await PATCH(request);

    expect(response.status).toBe(401);
  });

  it("should return 400 for invalid JSON", async () => {
    const client = createMockSupabaseClient();
    mockCreateClient.mockResolvedValue(client as never);

    const request = createInvalidJsonRequest();
    const response = await PATCH(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid JSON");
  });

  it("should return 400 when display_name is empty", async () => {
    const client = createMockSupabaseClient();
    mockCreateClient.mockResolvedValue(client as never);

    const request = createPatchRequest({ display_name: "" });
    const response = await PATCH(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toContain("display_name");
  });

  it("should return 400 when display_name exceeds 100 chars", async () => {
    const client = createMockSupabaseClient();
    mockCreateClient.mockResolvedValue(client as never);

    const request = createPatchRequest({ display_name: "a".repeat(101) });
    const response = await PATCH(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toContain("100");
  });

  it("should update display_name and return profile", async () => {
    const updatedProfile = { id: mockUser.id, display_name: "Updated", tenant_id: mockProfile.tenant_id };
    const client = createMockSupabaseClient();
    client.from = vi.fn((table: string) => {
      if (table === "chainthings_profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => ({ data: mockProfile, error: null })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(() => ({ data: updatedProfile, error: null })),
              })),
            })),
          })),
        } as never;
      }
      return {} as never;
    });
    mockCreateClient.mockResolvedValue(client as never);

    const request = createPatchRequest({ display_name: "  Updated  " });
    const response = await PATCH(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data.display_name).toBe("Updated");
  });
});
