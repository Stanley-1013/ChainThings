import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { getCredentialStrategy } from "@/lib/dev-services/credential-registry";
import {
  createMockSupabaseClient,
  mockProfile,
  mockUser,
} from "@/__tests__/mocks/supabase";
import { getJsonResponse } from "@/__tests__/helpers";
import { cookies } from "next/headers";

vi.mock("@/lib/dev-services/credential-registry", () => ({
  getCredentialStrategy: vi.fn(),
}));

const mockCreateClient = vi.mocked(createClient);
const mockGetCredentialStrategy = vi.mocked(getCredentialStrategy);
const mockCookies = vi.mocked(cookies);

function routeParams(service = "github") {
  return { params: Promise.resolve({ service }) };
}

function setupClient(options: {
  user?: typeof mockUser | null;
  profile?: typeof mockProfile | null;
} = {}) {
  const client = createMockSupabaseClient({
    user: options.user === undefined ? mockUser : options.user,
  });

  client.from = vi.fn((table: string) => {
    if (table === "chainthings_profiles") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => ({
              data: options.profile === undefined ? mockProfile : options.profile,
              error: null,
            })),
          })),
        })),
      } as never;
    }
    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
}

function setupCookieStore() {
  const cookieStore = {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    getAll: vi.fn(() => []),
  };
  mockCookies.mockResolvedValue(cookieStore as never);
  return cookieStore;
}

function setupOAuthStrategy(options: {
  requiresOAuth?: boolean;
  getAuthorizationUrl?: ((state: string) => string) | undefined;
} = {}) {
  const getAuthorizationUrl = Object.hasOwn(options, "getAuthorizationUrl")
    ? options.getAuthorizationUrl
    : vi.fn((state: string) => (
      `https://github.example/oauth?state=${encodeURIComponent(state)}`
    ));
  mockGetCredentialStrategy.mockReturnValue({
    requiresOAuth: vi.fn(() => options.requiresOAuth ?? true),
    getAuthorizationUrl,
  } as never);
  return { getAuthorizationUrl };
}

describe("POST /api/dev-services/[service]/authorize", () => {
  const originalSecret = process.env.CHAINTHINGS_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CHAINTHINGS_WEBHOOK_SECRET = "a".repeat(32);
    setupClient();
    setupCookieStore();
    setupOAuthStrategy();
  });

  afterEach(() => {
    process.env.CHAINTHINGS_WEBHOOK_SECRET = originalSecret;
    vi.restoreAllMocks();
  });

  it("should return 401 for unauthenticated OAuth authorization requests", async () => {
    setupClient({ user: null });

    const response = await POST(new Request("http://localhost/api/dev-services/github/authorize"), routeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when the current user has no tenant profile", async () => {
    setupClient({ profile: null });

    const response = await POST(new Request("http://localhost/api/dev-services/github/authorize"), routeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  it("should return 400 for unsupported services", async () => {
    mockGetCredentialStrategy.mockReturnValue(undefined);

    const response = await POST(
      new Request("http://localhost/api/dev-services/bitbucket/authorize"),
      routeParams("bitbucket"),
    );
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("OAuth not supported for bitbucket");
  });

  it("should return 400 when the service does not require OAuth", async () => {
    setupOAuthStrategy({ requiresOAuth: false });

    const response = await POST(
      new Request("http://localhost/api/dev-services/gitlab/authorize"),
      routeParams("gitlab"),
    );
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("OAuth not supported for gitlab");
  });

  it("should return 400 when the OAuth service has no authorization URL builder", async () => {
    setupOAuthStrategy({ getAuthorizationUrl: undefined });

    const response = await POST(new Request("http://localhost/api/dev-services/github/authorize"), routeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("OAuth not supported for github");
  });

  it("should return 500 when the state signing secret is missing", async () => {
    delete process.env.CHAINTHINGS_WEBHOOK_SECRET;

    const response = await POST(new Request("http://localhost/api/dev-services/github/authorize"), routeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("Server misconfiguration");
  });

  it("should return the authorization URL and persist signed state in an httpOnly cookie", async () => {
    const cookieStore = setupCookieStore();
    const { getAuthorizationUrl } = setupOAuthStrategy();

    const response = await POST(new Request("http://localhost/api/dev-services/github/authorize"), routeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.url).toMatch(/^https:\/\/github\.example\/oauth\?state=/);
    expect(cookieStore.set).toHaveBeenCalledWith(
      "ds_oauth_state",
      expect.stringMatching(/^tenant-456:github:[0-9a-f]{32}:[0-9a-f]{64}$/),
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        maxAge: 300,
        path: "/",
      }),
    );
    const state = vi.mocked(cookieStore.set).mock.calls[0][1];
    expect(getAuthorizationUrl).toHaveBeenCalledWith(state);
    expect(decodeURIComponent(new URL(body.url).searchParams.get("state") ?? "")).toBe(state);
  });
});
