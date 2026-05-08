import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { encryptSecretConfig } from "@/lib/dev-services/crypto";
import { GitHubClient } from "@/lib/dev-services/adapters/github";
import { JiraClient } from "@/lib/dev-services/adapters/jira";
import { GitLabClient } from "@/lib/dev-services/adapters/gitlab";
import {
  createMockSupabaseClient,
  mockProfile,
  mockUser,
} from "@/__tests__/mocks/supabase";
import { createJsonRequest, getJsonResponse } from "@/__tests__/helpers";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/dev-services/crypto", () => ({
  encryptSecretConfig: vi.fn(() => Buffer.from("encrypted-secret")),
}));

vi.mock("@/lib/dev-services/adapters/github", () => ({
  GitHubClient: vi.fn(),
}));

vi.mock("@/lib/dev-services/adapters/jira", () => ({
  JiraClient: vi.fn(),
}));

vi.mock("@/lib/dev-services/adapters/gitlab", () => ({
  GitLabClient: vi.fn(),
}));

const mockCreateClient = vi.mocked(createClient);
const mockAdminFrom = vi.mocked(supabaseAdmin.from);
const mockEncryptSecretConfig = vi.mocked(encryptSecretConfig);
const mockGitHubClient = vi.mocked(GitHubClient);
const mockJiraClient = vi.mocked(JiraClient);
const mockGitLabClient = vi.mocked(GitLabClient);

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

function createQueryChain<T>(result: QueryResult<T>) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(() => result),
  };
  return chain;
}

function projectParams(projectId = "project-1") {
  return { params: Promise.resolve({ projectId }) };
}

function setupClient(options: {
  user?: typeof mockUser | null;
  profile?: typeof mockProfile | null;
  project?: unknown | null;
} = {}) {
  const client = createMockSupabaseClient({
    user: options.user === undefined ? mockUser : options.user,
  });
  const profileChain = createQueryChain({
    data: options.profile === undefined ? mockProfile : options.profile,
    error: null,
  });
  const projectChain = createQueryChain({
    data: options.project === undefined ? { id: "project-1" } : options.project,
    error: null,
  });

  client.from = vi.fn((table: string) => {
    if (table === "chainthings_profiles") return profileChain as never;
    if (table === "chainthings_dev_projects") return projectChain as never;
    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
  return { projectChain };
}

function setupAdmin(options: {
  existing?: { id: string } | null;
  upsertError?: { message: string } | null;
  integration?: unknown;
  fetchError?: { message: string } | null;
} = {}) {
  const maybeSingle = vi.fn(() => ({
    data: options.existing ?? null,
    error: null,
  }));
  const update = vi.fn(() => ({
    eq: vi.fn(() => ({ error: options.upsertError ?? null })),
  }));
  const insert = vi.fn(() => ({ error: options.upsertError ?? null }));
  const fetchChain = createQueryChain({
    data:
      options.integration ??
      {
        id: "integration-1",
        service: "github",
        label: "GitHub",
        config: { external_user_id: "octo" },
        capabilities: ["code_review", "issues"],
        status: "active",
      },
    error: options.fetchError ?? null,
  });
  const table = {
    select: vi.fn((columns: string) => {
      if (columns === "id") {
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({ maybeSingle })),
            })),
          })),
        };
      }
      return fetchChain;
    }),
    update,
    insert,
  };

  mockAdminFrom.mockReturnValue(table as never);
  return { table, update, insert, maybeSingle };
}

describe("/api/dev-services/projects/[projectId]/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setupClient();
    setupAdmin();
    mockEncryptSecretConfig.mockReturnValue(Buffer.from("encrypted-secret"));
    mockGitHubClient.mockImplementation(function GitHubClientMock() {
      return {
        getAuthenticatedUser: vi.fn(async () => ({ id: "octo", avatarUrl: "https://avatar" })),
      } as never;
    });
    mockJiraClient.mockImplementation(function JiraClientMock() {
      return {
        getAuthenticatedUser: vi.fn(async () => ({ id: "jira-user", avatarUrl: null })),
      } as never;
    });
    mockGitLabClient.mockImplementation(function GitLabClientMock() {
      return {
        getAuthenticatedUser: vi.fn(async () => ({ id: "gitlab-user", avatarUrl: null })),
      } as never;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 401 for unauthenticated connect requests", async () => {
    setupClient({ user: null });
    const request = createJsonRequest("http://localhost/api/dev-services/projects/project-1/connect", {
      service: "github",
      access_token: "token",
    });

    const response = await POST(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when the project does not belong to the tenant", async () => {
    setupClient({ project: null });
    const request = createJsonRequest("http://localhost/api/dev-services/projects/project-1/connect", {
      service: "github",
      access_token: "token",
    });

    const response = await POST(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Project not found");
  });

  it("should reject unsupported service values", async () => {
    const request = createJsonRequest("http://localhost/api/dev-services/projects/project-1/connect", {
      service: "bitbucket",
      access_token: "token",
    });

    const response = await POST(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("service must be one of: github, gitlab, jira");
  });

  it("should require access tokens for GitHub and GitLab", async () => {
    const request = createJsonRequest("http://localhost/api/dev-services/projects/project-1/connect", {
      service: "github",
    });

    const response = await POST(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("access_token is required");
  });

  it("should encrypt credentials and insert a new GitHub integration after credential validation", async () => {
    const { insert } = setupAdmin();
    const request = createJsonRequest("http://localhost/api/dev-services/projects/project-1/connect", {
      service: "github",
      label: "GitHub",
      access_token: "gh-token",
      auto_review_enabled: true,
      auto_review_repos: ["chainthings/api"],
    });

    const response = await POST(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        id: "integration-1",
        service: "github",
        label: "GitHub",
        external_user_id: "octo",
        capabilities: ["code_review", "issues"],
        status: "active",
      },
      webhook_url: "http://localhost:3001/api/dev-services/webhooks/github/integration-1",
    });
    expect(mockGitHubClient).toHaveBeenCalledWith("gh-token");
    expect(mockEncryptSecretConfig).toHaveBeenCalledWith({ access_token: "gh-token" });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tenant-456",
        dev_project_id: "project-1",
        service: "github",
        label: "GitHub",
        secret_config: Buffer.from("encrypted-secret"),
        config: expect.objectContaining({
          auto_review_enabled: true,
          auto_review_repos: ["chainthings/api"],
          external_user_id: "octo",
          external_avatar_url: "https://avatar",
        }),
      }),
    );
  });

  it("should update an existing Jira integration with encrypted API token", async () => {
    const { update } = setupAdmin({
      existing: { id: "integration-existing" },
      integration: {
        id: "integration-existing",
        service: "jira",
        label: "Jira",
        config: { external_user_id: "jira-user" },
        capabilities: ["issues", "summary", "transitions"],
        status: "active",
      },
    });
    const request = createJsonRequest("http://localhost/api/dev-services/projects/project-1/connect", {
      service: "jira",
      label: "Jira",
      jira_domain: "example.atlassian.net",
      jira_email: "dev@example.com",
      api_token: "jira-token",
      jira_projects: ["PLAT"],
    });

    const response = await POST(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data.service).toBe("jira");
    expect(mockJiraClient).toHaveBeenCalledWith(
      "example.atlassian.net",
      "dev@example.com",
      "jira-token",
    );
    expect(mockEncryptSecretConfig).toHaveBeenCalledWith({
      access_token: "",
      api_token: "jira-token",
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "jira",
        config: expect.objectContaining({
          jira: {
            domain: "example.atlassian.net",
            email: "dev@example.com",
            projects: ["PLAT"],
            status_mapping: {},
          },
          external_user_id: "jira-user",
        }),
      }),
    );
  });

  it("should write status_mapping into jira config when provided", async () => {
    const { update } = setupAdmin({
      existing: { id: "integration-existing" },
      integration: {
        id: "integration-existing",
        service: "jira",
        label: "Jira",
        config: { external_user_id: "jira-user" },
        capabilities: ["issues", "summary", "transitions"],
        status: "active",
      },
    });
    const request = createJsonRequest("http://localhost/api/dev-services/projects/project-1/connect", {
      service: "jira",
      label: "Jira",
      jira_domain: "example.atlassian.net",
      jira_email: "dev@example.com",
      api_token: "jira-token",
      jira_projects: ["PLAT"],
      status_mapping: { mr_opened: "In Review", mr_merged: "Done" },
    });

    const response = await POST(request, projectParams());
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          jira: {
            domain: "example.atlassian.net",
            email: "dev@example.com",
            projects: ["PLAT"],
            status_mapping: { mr_opened: "In Review", mr_merged: "Done" },
          },
        }),
      }),
    );
  });

  it("should use empty status_mapping when status_mapping is not provided", async () => {
    const { insert } = setupAdmin();
    const request = createJsonRequest("http://localhost/api/dev-services/projects/project-1/connect", {
      service: "jira",
      jira_domain: "example.atlassian.net",
      jira_email: "dev@example.com",
      api_token: "jira-token",
    });

    const response = await POST(request, projectParams());
    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          jira: expect.objectContaining({
            status_mapping: {},
          }),
        }),
      }),
    );
  });

  it("should reject status_mapping with value exceeding 100 characters", async () => {
    const request = createJsonRequest("http://localhost/api/dev-services/projects/project-1/connect", {
      service: "jira",
      jira_domain: "example.atlassian.net",
      jira_email: "dev@example.com",
      api_token: "jira-token",
      status_mapping: { mr_opened: "x".repeat(101) },
    });

    const response = await POST(request, projectParams());
    const body = await getJsonResponse(response);
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/status_mapping\.mr_opened/);
  });

  it("should reject invalid credentials before writing an integration", async () => {
    const { insert, update } = setupAdmin();
    mockGitHubClient.mockImplementation(function GitHubClientMock() {
      return {
        getAuthenticatedUser: vi.fn(async () => {
          throw new Error("bad token");
        }),
      } as never;
    });
    const request = createJsonRequest("http://localhost/api/dev-services/projects/project-1/connect", {
      service: "github",
      access_token: "bad-token",
    });

    const response = await POST(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid credentials: bad token");
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  // ── B6: null status_mapping must return 400, not 500 ──────────────────────
  it("should return 400 when status_mapping is null (B6)", async () => {
    const request = createJsonRequest(
      "http://localhost/api/dev-services/projects/project-1/connect",
      {
        service: "jira",
        jira_domain: "example.atlassian.net",
        jira_email: "dev@example.com",
        api_token: "jira-token",
        status_mapping: null,
      },
    );

    const response = await POST(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/status_mapping/i);
  });

  it("should return 400 when status_mapping is an array (B6 — array guard)", async () => {
    const request = createJsonRequest(
      "http://localhost/api/dev-services/projects/project-1/connect",
      {
        service: "jira",
        jira_domain: "example.atlassian.net",
        jira_email: "dev@example.com",
        api_token: "jira-token",
        status_mapping: ["mr_opened"],
      },
    );

    const response = await POST(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/status_mapping/i);
  });

  // ── B7: jira_projects key format validation ───────────────────────────────
  it("should return 400 when a jira_projects key is lowercase (B7)", async () => {
    const request = createJsonRequest(
      "http://localhost/api/dev-services/projects/project-1/connect",
      {
        service: "jira",
        jira_domain: "example.atlassian.net",
        jira_email: "dev@example.com",
        api_token: "jira-token",
        jira_projects: ["proj"],
      },
    );

    const response = await POST(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/jira_projects/i);
  });

  it("should return 400 when a jira_projects key contains regex metacharacters (B7)", async () => {
    const request = createJsonRequest(
      "http://localhost/api/dev-services/projects/project-1/connect",
      {
        service: "jira",
        jira_domain: "example.atlassian.net",
        jira_email: "dev@example.com",
        api_token: "jira-token",
        jira_projects: ["PROJ+EXTRA"],
      },
    );

    const response = await POST(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/jira_projects/i);
  });

  it("should accept valid uppercase jira_projects keys (B7)", async () => {
    const { insert } = setupAdmin();
    const request = createJsonRequest(
      "http://localhost/api/dev-services/projects/project-1/connect",
      {
        service: "jira",
        jira_domain: "example.atlassian.net",
        jira_email: "dev@example.com",
        api_token: "jira-token",
        jira_projects: ["PROJ", "BACK2", "MY_SVC"],
      },
    );

    const response = await POST(request, projectParams());

    expect(response.status).toBe(200);
  });
});
