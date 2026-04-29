import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PUT } from "./route";
import { createClient } from "@/lib/supabase/server";
import {
  createMockSupabaseClient,
  mockProfile,
  mockUser,
} from "@/__tests__/mocks/supabase";
import { createJsonRequest, getJsonResponse } from "@/__tests__/helpers";

const mockCreateClient = vi.mocked(createClient);

interface QueryResult<T> {
  data: T | null;
  error: { code?: string; message: string } | null;
}

function createQueryChain<T>(result: QueryResult<T>) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(() => result),
    upsert: vi.fn(() => chain),
  };
  return chain;
}

function setupClient(options: {
  user?: typeof mockUser | null;
  profile?: typeof mockProfile | null;
  settings?: unknown | null;
  settingsError?: { code?: string; message: string } | null;
  upsertResult?: unknown;
  upsertError?: { message: string } | null;
} = {}) {
  const client = createMockSupabaseClient({
    user: options.user === undefined ? mockUser : options.user,
  });
  const profile = options.profile === undefined ? mockProfile : options.profile;
  const profileChain = createQueryChain({ data: profile, error: null });
  const selectSettingsChain = createQueryChain({
    data: options.settings ?? null,
    error: options.settingsError ?? null,
  });
  const upsertChain = createQueryChain({
    data: options.upsertResult ?? {
      enabled: true,
      frequency: "daily",
      timezone: "UTC",
      send_hour_local: 11,
    },
    error: options.upsertError ?? null,
  });

  const settingsTable = {
    select: selectSettingsChain.select,
    eq: selectSettingsChain.eq,
    single: selectSettingsChain.single,
    upsert: vi.fn(() => upsertChain),
  };

  client.from = vi.fn((table: string) => {
    if (table === "chainthings_profiles") return profileChain as never;
    if (table === "chainthings_notification_settings") return settingsTable as never;
    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
  return { profileChain, selectSettingsChain, settingsTable, upsertChain };
}

describe("/api/notifications/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupClient();
  });

  it("should return 401 for unauthenticated settings requests", async () => {
    setupClient({ user: null });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when profile lookup has no tenant", async () => {
    setupClient({ profile: null });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  it("should return default settings when no row exists", async () => {
    setupClient({
      settingsError: { code: "PGRST116", message: "No rows" },
    });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        enabled: false,
        frequency: "weekly",
        timezone: "Asia/Taipei",
        send_hour_local: 9,
      },
    });
  });

  it("should return saved settings for the current tenant user", async () => {
    const settings = {
      enabled: true,
      frequency: "every3days",
      timezone: "Asia/Tokyo",
      send_hour_local: 8,
    };
    const { selectSettingsChain } = setupClient({ settings });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: settings });
    expect(selectSettingsChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-456");
    expect(selectSettingsChain.eq).toHaveBeenCalledWith("user_id", "user-123");
  });

  it("should propagate settings read errors except missing rows", async () => {
    setupClient({ settingsError: { code: "XX000", message: "read failed" } });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("read failed");
  });

  it("should reject invalid notification frequencies", async () => {
    const request = createJsonRequest("http://localhost/api/notifications/settings", {
      frequency: "hourly",
    });

    const response = await PUT(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toContain("Invalid frequency");
  });

  it("should reject non-integer send hours outside the local day", async () => {
    const request = createJsonRequest("http://localhost/api/notifications/settings", {
      send_hour_local: 24,
    });

    const response = await PUT(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("send_hour_local must be an integer between 0 and 23");
  });

  it("should reject invalid timezones", async () => {
    const request = createJsonRequest("http://localhost/api/notifications/settings", {
      timezone: "Mars/Base",
    });

    const response = await PUT(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid timezone");
  });

  it("should upsert validated settings for the current tenant user", async () => {
    const { settingsTable } = setupClient();
    const request = createJsonRequest("http://localhost/api/notifications/settings", {
      enabled: true,
      frequency: "daily",
      timezone: "UTC",
      send_hour_local: 11,
    });

    const response = await PUT(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      enabled: true,
      frequency: "daily",
      timezone: "UTC",
      send_hour_local: 11,
    });
    expect(settingsTable.upsert).toHaveBeenCalledWith(
      {
        tenant_id: "tenant-456",
        user_id: "user-123",
        enabled: true,
        frequency: "daily",
        timezone: "UTC",
        send_hour_local: 11,
        updated_at: expect.any(String),
      },
      { onConflict: "tenant_id,user_id" },
    );
  });

  it("should propagate settings upsert errors", async () => {
    setupClient({ upsertError: { message: "upsert failed" } });
    const request = createJsonRequest("http://localhost/api/notifications/settings", {
      enabled: true,
    });

    const response = await PUT(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("upsert failed");
  });
});
