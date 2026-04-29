import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HedyClient, HedyApiError } from "@/lib/integrations/hedy/client";
import {
  createMockSupabaseClient,
  mockProfile,
} from "@/__tests__/mocks/supabase";
import { getJsonResponse } from "@/__tests__/helpers";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/integrations/hedy/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/integrations/hedy/client")>();
  return { ...actual, HedyClient: vi.fn(), HedyApiError: actual.HedyApiError };
});

const mockCreateClient = vi.mocked(createClient);
const mockSupabaseAdminFrom = vi.mocked(supabaseAdmin.from);
const mockHedyClient = vi.mocked(HedyClient);

interface IntegrationRow {
  config: { api_key?: string };
}

function setupClient(profile: typeof mockProfile | null = mockProfile) {
  const client = createMockSupabaseClient();

  client.from = vi.fn((table: string) => {
    if (table === "chainthings_profiles") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => ({ data: profile, error: null })),
          })),
        })),
      } as never;
    }
    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
  return client;
}

function setupAdmin(integration: IntegrationRow | null = {
  config: { api_key: "hedy-key" },
}) {
  mockSupabaseAdminFrom.mockImplementation((table: string) => {
    if (table === "chainthings_integrations") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => ({ data: integration, error: null })),
            })),
          })),
        })),
      } as never;
    }

    return {} as never;
  });
}

function setupHedyClient(options: {
  user?: {
    id: string;
    email?: string;
    name?: string;
    pro?: boolean;
    cloudSyncEnabled?: boolean;
  };
  error?: Error;
} = {}) {
  const getMe = vi.fn(async () => {
    if (options.error) throw options.error;
    return (
      options.user ?? {
        id: "hedy-user-1",
        email: "hedy@example.com",
        name: "Hedy User",
        pro: true,
        cloudSyncEnabled: false,
      }
    );
  });

  mockHedyClient.mockImplementation(function HedyClientMock() {
    return { getMe } as never;
  });

  return { getMe };
}

describe("GET /api/integrations/hedy/check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupClient();
    setupAdmin();
    setupHedyClient();
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
    setupClient(null);

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  it("should return 400 when no api key is configured", async () => {
    setupAdmin({ config: {} });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      error: "No Hedy API key configured",
    });

    setupAdmin({ config: { api_key: "sk-••••" } });

    const redactedResponse = await GET();
    const redactedBody = await getJsonResponse(redactedResponse);

    expect(redactedResponse.status).toBe(400);
    expect(redactedBody).toEqual({
      ok: false,
      error: "No Hedy API key configured",
    });
  });

  it("should return ok with the Hedy user", async () => {
    const { getMe } = setupHedyClient({
      user: {
        id: "hedy-user-1",
        email: "hedy@example.com",
        name: "Hedy User",
        pro: true,
        cloudSyncEnabled: true,
      },
    });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      user: {
        id: "hedy-user-1",
        email: "hedy@example.com",
        name: "Hedy User",
        pro: true,
        cloudSyncEnabled: true,
      },
    });
    expect(getMe).toHaveBeenCalledOnce();
  });

  it("should map Hedy auth errors to 400", async () => {
    setupHedyClient({ error: new HedyApiError("Invalid API key", 401) });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      error: "Invalid API key",
      status: 401,
    });
  });

  it("should map Hedy server errors to 502", async () => {
    setupHedyClient({ error: new HedyApiError("Hedy unavailable", 500) });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(502);
    expect(body).toEqual({
      ok: false,
      error: "Hedy unavailable",
      status: 500,
    });
  });

  it("should map plain errors to 502", async () => {
    setupHedyClient({ error: new Error("network failure") });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(502);
    expect(body).toEqual({
      ok: false,
      error: "network failure",
    });
  });
});
