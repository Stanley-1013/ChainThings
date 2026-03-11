import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase/server";
import { createMockSupabaseClient, mockProfile } from "@/__tests__/mocks/supabase";
import { createGetRequest, getJsonResponse } from "@/__tests__/helpers";

const mockCreateClient = vi.mocked(createClient);

const BASE_URL = "http://localhost:3000/api/items";

function setupClient(tableOverrides?: Record<string, { data: unknown; error: unknown; count?: number }>) {
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
      const orderRange = {
        order: vi.fn(() => ({
          range: vi.fn(() => override),
        })),
      };
      // eq returns an object that has both .order() (for no type filter)
      // and .eq() (for type filter, which then returns orderRange)
      const eqFn: ReturnType<typeof vi.fn> = vi.fn(() => ({
        ...orderRange,
        eq: vi.fn(() => orderRange),
      }));
      return {
        select: vi.fn(() => ({
          eq: eqFn,
        })),
      } as never;
    }

    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
  return client;
}

describe("GET /api/items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 for unauthenticated user", async () => {
    const client = createMockSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as never);

    const request = createGetRequest(BASE_URL);
    const response = await GET(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when profile not found", async () => {
    const client = createMockSupabaseClient({ profile: null });
    mockCreateClient.mockResolvedValue(client as never);

    const request = createGetRequest(BASE_URL);
    const response = await GET(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  it("should return items list with pagination", async () => {
    const items = [
      { id: "item-1", type: "meeting_notes", title: "Meeting 1" },
      { id: "item-2", type: "action_item", title: "Action 1" },
    ];
    setupClient({
      chainthings_items: { data: items, error: null, count: 2 },
    });

    const request = createGetRequest(BASE_URL);
    const response = await GET(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data).toEqual(items);
    expect(body.pagination).toEqual({ page: 1, limit: 20, total: 2 });
  });

  it("should support type filter", async () => {
    const items = [{ id: "item-1", type: "meeting_notes", title: "Meeting 1" }];
    setupClient({
      chainthings_items: { data: items, error: null, count: 1 },
    });

    const request = createGetRequest(`${BASE_URL}?type=meeting_notes`);
    const response = await GET(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data).toEqual(items);
  });

  it("should support pagination params", async () => {
    setupClient({
      chainthings_items: { data: [], error: null, count: 0 },
    });

    const request = createGetRequest(`${BASE_URL}?page=2&limit=10`);
    const response = await GET(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.pagination).toEqual({ page: 2, limit: 10, total: 0 });
  });

  it("should return 500 on database error", async () => {
    setupClient({
      chainthings_items: { data: null, error: { message: "DB error" } },
    });

    const request = createGetRequest(BASE_URL);
    const response = await GET(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("DB error");
  });
});
