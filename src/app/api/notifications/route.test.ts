import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PATCH } from "./route";
import { createClient } from "@/lib/supabase/server";
import {
  createMockSupabaseClient,
  mockProfile,
  mockUser,
} from "@/__tests__/mocks/supabase";
import { createJsonRequest, getJsonResponse } from "@/__tests__/helpers";

const mockCreateClient = vi.mocked(createClient);

interface ChainResult {
  data: unknown;
  error: { message: string } | null;
}

function createQueryChain(result: ChainResult) {
  const chain = {
    ...result,
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => result),
    update: vi.fn(() => chain),
    single: vi.fn(() => result),
  };
  return chain;
}

function setupClient(options: {
  user?: typeof mockUser | null;
  profile?: typeof mockProfile | null;
  notifications?: unknown[];
  notificationError?: { message: string } | null;
  patchError?: { message: string } | null;
} = {}) {
  const client = createMockSupabaseClient({
    user: options.user === undefined ? mockUser : options.user,
  });
  const profile = options.profile === undefined ? mockProfile : options.profile;
  const profileChain = createQueryChain({
    data: profile,
    error: null,
  });
  const listChain = createQueryChain({
    data: options.notifications ?? [],
    error: options.notificationError ?? null,
  });
  const patchChain = createQueryChain({
    data: null,
    error: options.patchError ?? null,
  });

  client.from = vi.fn((table: string) => {
    if (table === "chainthings_profiles") return profileChain as never;
    if (table === "chainthings_notification_cache") return listChain as never;
    return {} as never;
  });
  listChain.update.mockImplementation(() => patchChain);

  mockCreateClient.mockResolvedValue(client as never);
  return { client, profileChain, listChain, patchChain };
}

describe("/api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupClient();
  });

  it("should return 401 for unauthenticated list requests", async () => {
    setupClient({ user: null });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when list request has no tenant profile", async () => {
    setupClient({ profile: null });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  it("should list generated and shown notifications for the current tenant user", async () => {
    const notifications = [
      { id: "notif-1", status: "generated", content: { summary: "Summary" } },
    ];
    const { listChain } = setupClient({ notifications });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: notifications });
    expect(listChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-456");
    expect(listChain.eq).toHaveBeenCalledWith("user_id", "user-123");
    expect(listChain.in).toHaveBeenCalledWith("status", ["generated", "shown"]);
    expect(listChain.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(listChain.limit).toHaveBeenCalledWith(5);
  });

  it("should propagate list database errors", async () => {
    setupClient({ notificationError: { message: "cache unavailable" } });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("cache unavailable");
  });

  it("should return 400 when marking without a notification id", async () => {
    const request = createJsonRequest("http://localhost/api/notifications", {});

    const response = await PATCH(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("id is required");
  });

  it("should mark a notification as shown for the current user", async () => {
    const { listChain, patchChain } = setupClient();
    const request = createJsonRequest("http://localhost/api/notifications", {
      id: "notif-1",
    });

    const response = await PATCH(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { marked: true } });
    expect(listChain.update).toHaveBeenCalledWith({
      status: "shown",
      shown_at: expect.any(String),
    });
    expect(patchChain.eq).toHaveBeenCalledWith("id", "notif-1");
    expect(patchChain.eq).toHaveBeenCalledWith("user_id", "user-123");
  });

  it("should propagate mark database errors", async () => {
    setupClient({ patchError: { message: "update failed" } });
    const request = createJsonRequest("http://localhost/api/notifications", {
      id: "notif-1",
    });

    const response = await PATCH(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("update failed");
  });
});
