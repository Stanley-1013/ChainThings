import { createHmac } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCredentialStrategy } from "@/lib/dev-services/credential-registry";
import { encryptSecretConfig } from "@/lib/dev-services/crypto";
import { GitHubClient } from "@/lib/dev-services/adapters/github";
import { createGetRequest } from "@/__tests__/helpers";
import { cookies } from "next/headers";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/dev-services/credential-registry", () => ({
  getCredentialStrategy: vi.fn(),
}));

vi.mock("@/lib/dev-services/crypto", () => ({
  encryptSecretConfig: vi.fn(() => Buffer.from("encrypted-secret")),
}));

vi.mock("@/lib/dev-services/adapters/github", () => ({
  GitHubClient: vi.fn(),
}));

const mockAdminFrom = vi.mocked(supabaseAdmin.from);
const mockGetCredentialStrategy = vi.mocked(getCredentialStrategy);
const mockEncryptSecretConfig = vi.mocked(encryptSecretConfig);
const mockGitHubClient = vi.mocked(GitHubClient);
const mockCookies = vi.mocked(cookies);

function routeParams(service = "github") {
  return { params: Promise.resolve({ service }) };
}

function signedState(options: {
  tenantId?: string;
  service?: string;
  nonce?: string;
  secret?: string;
  signatureOverride?: string;
} = {}) {
  const tenantId = options.tenantId ?? "tenant-456";
  const service = options.service ?? "github";
  const nonce = options.nonce ?? "nonce-123";
  const secret = options.secret ?? "a".repeat(32);
  const payload = `${tenantId}:${service}:${nonce}`;
  const signature = options.signatureOverride
    ?? createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}:${signature}`;
}

function setupCookieStore(state: string | null) {
  const cookieStore = {
    get: vi.fn(() => (state ? { value: state } : undefined)),
    delete: vi.fn(),
    set: vi.fn(),
    getAll: vi.fn(() => []),
  };
  mockCookies.mockResolvedValue(cookieStore as never);
  return cookieStore;
}

function setupStrategy(options: {
  tokenResult?: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  exchangeError?: Error;
} = {}) {
  const exchangeCodeForToken = vi.fn(async () => {
    if (options.exchangeError) throw options.exchangeError;
    return options.tokenResult ?? {
      access_token: "gh-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      scope: "repo,user",
    };
  });
  mockGetCredentialStrategy.mockReturnValue({ exchangeCodeForToken } as never);
  return { exchangeCodeForToken };
}

function setupAdmin(options: {
  existing?: { id: string } | null;
  insertError?: { message: string } | null;
  updateError?: { message: string } | null;
} = {}) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];

  mockAdminFrom.mockImplementation((table: string) => {
    if (table !== "chainthings_integrations") return {} as never;
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({
              maybeSingle: vi.fn(() => ({
                data: options.existing ?? null,
                error: null,
              })),
            })),
          })),
        })),
      })),
      insert: vi.fn((payload: unknown) => {
        inserts.push(payload);
        return { error: options.insertError ?? null };
      }),
      update: vi.fn((payload: unknown) => {
        updates.push(payload);
        return {
          eq: vi.fn(() => ({ error: options.updateError ?? null })),
        };
      }),
    } as never;
  });

  return { inserts, updates };
}

function callbackRequest(state: string, code = "oauth-code") {
  return createGetRequest(
    `http://localhost/api/dev-services/github/callback?code=${code}&state=${encodeURIComponent(state)}`,
  );
}

function redirectLocation(response: Response) {
  return response.headers.get("location") ?? "";
}

describe("GET /api/dev-services/[service]/callback", () => {
  const originalSecret = process.env.CHAINTHINGS_WEBHOOK_SECRET;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.CHAINTHINGS_WEBHOOK_SECRET = "a".repeat(32);
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
    const state = signedState();
    setupCookieStore(state);
    setupStrategy();
    setupAdmin();
    mockEncryptSecretConfig.mockReturnValue(Buffer.from("encrypted-secret"));
    mockGitHubClient.mockImplementation(function GitHubClientMock() {
      return {
        getAuthenticatedUser: vi.fn(async () => ({
          login: "octocat",
          avatarUrl: "https://avatars.example/octocat",
        })),
      } as never;
    });
  });

  afterEach(() => {
    process.env.CHAINTHINGS_WEBHOOK_SECRET = originalSecret;
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    vi.restoreAllMocks();
  });

  it("should redirect when callback params are missing", async () => {
    const response = await GET(
      createGetRequest("http://localhost/api/dev-services/github/callback"),
      routeParams(),
    );

    expect(response.status).toBe(307);
    expect(redirectLocation(response)).toBe("http://localhost/settings?error=missing_params");
  });

  it("should redirect when the state cookie is missing", async () => {
    const state = signedState();
    setupCookieStore(null);

    const response = await GET(callbackRequest(state), routeParams());

    expect(response.status).toBe(307);
    expect(redirectLocation(response)).toBe("http://localhost/settings?error=invalid_state");
  });

  it("should redirect when the callback state does not match the cookie", async () => {
    setupCookieStore(signedState({ nonce: "cookie-nonce" }));

    const response = await GET(callbackRequest(signedState({ nonce: "param-nonce" })), routeParams());

    expect(response.status).toBe(307);
    expect(redirectLocation(response)).toBe("http://localhost/settings?error=invalid_state");
  });

  it("should redirect when the state service does not match the route service", async () => {
    const state = signedState({ service: "gitlab" });
    setupCookieStore(state);

    const response = await GET(callbackRequest(state), routeParams("github"));

    expect(response.status).toBe(307);
    expect(redirectLocation(response)).toBe("http://localhost/settings?error=service_mismatch");
  });

  it("should redirect when the signed state HMAC is invalid", async () => {
    const state = signedState({ signatureOverride: "0".repeat(64) });
    setupCookieStore(state);

    const response = await GET(callbackRequest(state), routeParams());

    expect(response.status).toBe(307);
    expect(redirectLocation(response)).toBe("http://localhost/settings?error=invalid_signature");
  });

  it("should redirect when the service cannot exchange OAuth codes", async () => {
    const state = signedState();
    setupCookieStore(state);
    mockGetCredentialStrategy.mockReturnValue(undefined);

    const response = await GET(callbackRequest(state), routeParams("github"));

    expect(response.status).toBe(307);
    expect(redirectLocation(response)).toBe("http://localhost/settings?error=unsupported");
  });

  it("should redirect when the OAuth code exchange fails", async () => {
    const state = signedState();
    setupCookieStore(state);
    setupStrategy({ exchangeError: new Error("bad code") });

    const response = await GET(callbackRequest(state), routeParams());

    expect(response.status).toBe(307);
    expect(redirectLocation(response)).toBe("http://localhost/settings?error=token_exchange_failed");
  });

  it("should insert a tenant-level integration and redirect to connected status", async () => {
    const state = signedState();
    const { inserts } = setupAdmin({ existing: null });
    setupCookieStore(state);

    const response = await GET(callbackRequest(state), routeParams());

    expect(response.status).toBe(307);
    expect(redirectLocation(response)).toBe(
      "http://localhost:3001/settings?tab=integrations&service=github&status=connected",
    );
    expect(mockEncryptSecretConfig).toHaveBeenCalledWith({
      access_token: "gh-token",
      refresh_token: "refresh-token",
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      tenant_id: "tenant-456",
      dev_project_id: null,
      service: "github",
      label: "github (octocat)",
      status: "active",
      enabled: true,
      capabilities: ["code_review", "issues", "test_gen", "summary", "branches"],
      config: expect.objectContaining({
        auth_type: "oauth2",
        external_user_id: "octocat",
        external_avatar_url: "https://avatars.example/octocat",
        scopes: ["repo", "user"],
      }),
      secret_config: Buffer.from("encrypted-secret"),
    });
  });

  it("should update an existing tenant-level integration", async () => {
    const state = signedState();
    const { updates } = setupAdmin({ existing: { id: "integration-existing" } });
    setupCookieStore(state);

    const response = await GET(callbackRequest(state), routeParams());

    expect(response.status).toBe(307);
    expect(redirectLocation(response)).toBe(
      "http://localhost:3001/settings?tab=integrations&service=github&status=connected",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      tenant_id: "tenant-456",
      service: "github",
      label: "github (octocat)",
      status: "active",
    });
  });
});
