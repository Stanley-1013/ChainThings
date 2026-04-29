import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import {
  createMockSupabaseClient,
  mockProfile,
  mockUser,
} from "@/__tests__/mocks/supabase";
import { createJsonRequest, getJsonResponse } from "@/__tests__/helpers";

const mockCreateClient = vi.mocked(createClient);

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

function createQueryChain<T>(result: QueryResult<T>) {
  const chain = {
    ...result,
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => result),
    insert: vi.fn(() => chain),
    single: vi.fn(() => result),
  };
  return chain;
}

function setupClient(options: {
  user?: typeof mockUser | null;
  profile?: typeof mockProfile | null;
  projects?: unknown[];
  projectsError?: { message: string } | null;
  integrations?: unknown[];
  integrationsError?: { message: string } | null;
  createdProject?: unknown;
  createError?: { message: string } | null;
} = {}) {
  const client = createMockSupabaseClient({
    user: options.user === undefined ? mockUser : options.user,
  });
  const profileChain = createQueryChain({
    data: options.profile === undefined ? mockProfile : options.profile,
    error: null,
  });
  const projectsChain = createQueryChain({
    data: options.projects ?? [],
    error: options.projectsError ?? null,
  });
  const integrationsChain = createQueryChain({
    data: options.integrations ?? [],
    error: options.integrationsError ?? null,
  });
  const insertChain = createQueryChain({
    data: options.createdProject ?? { id: "project-new", name: "New API" },
    error: options.createError ?? null,
  });
  const projectsTable = {
    select: projectsChain.select,
    eq: projectsChain.eq,
    order: projectsChain.order,
    insert: vi.fn(() => insertChain),
  };

  client.from = vi.fn((table: string) => {
    if (table === "chainthings_profiles") return profileChain as never;
    if (table === "chainthings_dev_projects") return projectsTable as never;
    if (table === "chainthings_integrations") return integrationsChain as never;
    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
  return { profileChain, projectsChain, integrationsChain, projectsTable, insertChain };
}

describe("/api/dev-services/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setupClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 401 for unauthenticated list requests", async () => {
    setupClient({ user: null });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when the user profile has no tenant", async () => {
    setupClient({ profile: null });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  it("should list projects for the current tenant with non-secret integration summaries", async () => {
    const projects = [
      { id: "project-1", name: "API", metadata: {} },
      { id: "project-2", name: "Worker", metadata: {} },
    ];
    const integrations = [
      {
        dev_project_id: "project-1",
        service: "github",
        label: "GitHub",
        status: "active",
        config: { external_user_id: "octo" },
      },
    ];
    const { projectsChain, integrationsChain } = setupClient({ projects, integrations });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      {
        id: "project-1",
        name: "API",
        metadata: {},
        integrations: [
          {
            service: "github",
            label: "GitHub",
            status: "active",
            external_user_id: "octo",
          },
        ],
      },
      { id: "project-2", name: "Worker", metadata: {}, integrations: [] },
    ]);
    expect(projectsChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-456");
    expect(projectsChain.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(integrationsChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-456");
    expect(integrationsChain.in).toHaveBeenCalledWith("dev_project_id", ["project-1", "project-2"]);
  });

  it("should skip integration lookup when no projects exist", async () => {
    const { integrationsChain } = setupClient({ projects: [] });

    const response = await GET();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: [] });
    expect(integrationsChain.select).not.toHaveBeenCalled();
  });

  it("should return 400 when creating without a valid name", async () => {
    const request = createJsonRequest("http://localhost/api/dev-services/projects", {
      name: "   ",
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("name is required");
  });

  it("should create a project scoped to the current tenant", async () => {
    const createdProject = { id: "project-new", name: "New API", metadata: { repo: "main" } };
    const { projectsTable } = setupClient({ createdProject });
    const request = createJsonRequest("http://localhost/api/dev-services/projects", {
      name: "  New API  ",
      description: "Backend work",
      metadata: { repo: "main" },
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(201);
    expect(body).toEqual({ data: createdProject });
    expect(projectsTable.insert).toHaveBeenCalledWith({
      tenant_id: "tenant-456",
      name: "New API",
      description: "Backend work",
      context_notes: null,
      default_repo_ref: null,
      default_jira_project: null,
      metadata: { repo: "main" },
    });
  });

  it("should return 500 when project creation fails", async () => {
    setupClient({ createError: { message: "insert failed" } });
    const request = createJsonRequest("http://localhost/api/dev-services/projects", {
      name: "New API",
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("Internal server error");
  });
});
