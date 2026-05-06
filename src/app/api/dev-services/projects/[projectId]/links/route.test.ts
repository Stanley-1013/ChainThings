import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  createMockSupabaseClient,
  mockProfile,
  mockUser,
} from "@/__tests__/mocks/supabase";
import { createGetRequest, getJsonResponse } from "@/__tests__/helpers";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

const mockCreateClient = vi.mocked(createClient);
const mockAdminFrom = vi.mocked(supabaseAdmin.from);

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

  const profileChain = {
    select: vi.fn(() => profileChain),
    eq: vi.fn(() => profileChain),
    single: vi.fn(() => ({
      data: options.profile === undefined ? mockProfile : options.profile,
      error: null,
    })),
  };

  const projectChain = {
    select: vi.fn(() => projectChain),
    eq: vi.fn(() => projectChain),
    single: vi.fn(() => ({
      data: options.project === undefined ? { id: "project-1" } : options.project,
      error: null,
    })),
  };

  client.from = vi.fn((table: string) => {
    if (table === "chainthings_profiles") return profileChain as never;
    if (table === "chainthings_dev_projects") return projectChain as never;
    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
}

function setupAdminLinks(options: {
  rows?: unknown[];
  error?: { message: string } | null;
} = {}) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => ({
      data: options.rows ?? [],
      error: options.error ?? null,
    })),
  };
  mockAdminFrom.mockReturnValue(chain as never);
  return chain;
}

describe("/api/dev-services/projects/[projectId]/links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setupClient();
    setupAdminLinks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 401 for unauthenticated requests", async () => {
    setupClient({ user: null });
    const request = createGetRequest("http://localhost/api/dev-services/projects/project-1/links");

    const response = await GET(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when project does not exist or does not belong to tenant", async () => {
    setupClient({ project: null });
    const request = createGetRequest("http://localhost/api/dev-services/projects/project-1/links");

    const response = await GET(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Project not found");
  });

  it("should return an empty data array when no links exist", async () => {
    setupAdminLinks({ rows: [] });
    const request = createGetRequest("http://localhost/api/dev-services/projects/project-1/links");

    const response = await GET(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: [] });
  });

  it("should return service links with camelCase shape", async () => {
    const now = new Date().toISOString();
    setupAdminLinks({
      rows: [
        {
          id: "link-1",
          source_service: "jira",
          source_type: "ticket",
          source_ref: "PROJ-42",
          source_url: "https://example.atlassian.net/browse/PROJ-42",
          target_service: "github",
          target_type: "merge_request",
          target_ref: "99",
          target_url: "https://github.com/owner/repo/pull/99",
          link_type: "ticket_mr",
          status: "active",
          created_at: now,
        },
      ],
    });
    const request = createGetRequest("http://localhost/api/dev-services/projects/project-1/links");

    const response = await GET(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toEqual({
      id: "link-1",
      sourceService: "jira",
      sourceType: "ticket",
      sourceRef: "PROJ-42",
      sourceUrl: "https://example.atlassian.net/browse/PROJ-42",
      targetService: "github",
      targetType: "merge_request",
      targetRef: "99",
      targetUrl: "https://github.com/owner/repo/pull/99",
      linkType: "ticket_mr",
      status: "active",
      createdAt: now,
    });
  });

  it("should handle null source_url and target_url", async () => {
    const now = new Date().toISOString();
    setupAdminLinks({
      rows: [
        {
          id: "link-2",
          source_service: "jira",
          source_type: "ticket",
          source_ref: "BACK-1",
          source_url: null,
          target_service: "gitlab",
          target_type: "merge_request",
          target_ref: "5",
          target_url: null,
          link_type: "ticket_mr",
          status: "active",
          created_at: now,
        },
      ],
    });
    const request = createGetRequest("http://localhost/api/dev-services/projects/project-1/links");

    const response = await GET(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data[0].sourceUrl).toBeNull();
    expect(body.data[0].targetUrl).toBeNull();
  });

  it("should return 500 when admin query fails", async () => {
    setupAdminLinks({ rows: undefined, error: { message: "DB error" } });
    const request = createGetRequest("http://localhost/api/dev-services/projects/project-1/links");

    const response = await GET(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("Internal server error");
  });
});
