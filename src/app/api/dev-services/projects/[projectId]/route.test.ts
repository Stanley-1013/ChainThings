import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, PATCH, DELETE } from "./route";
import { createClient } from "@/lib/supabase/server";
import {
  createMockSupabaseClient,
  mockProfile,
  mockUser,
} from "@/__tests__/mocks/supabase";
import {
  createDeleteRequest,
  createGetRequest,
  createJsonRequest,
  getJsonResponse,
} from "@/__tests__/helpers";

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
    single: vi.fn(() => result),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
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
  integrations?: unknown[];
  integrationsError?: { message: string } | null;
  updatedProject?: unknown;
  updateError?: { message: string } | null;
  deleteError?: { message: string } | null;
} = {}) {
  const client = createMockSupabaseClient({
    user: options.user === undefined ? mockUser : options.user,
  });
  const profileChain = createQueryChain({
    data: options.profile === undefined ? mockProfile : options.profile,
    error: null,
  });
  const projectChain = createQueryChain({
    data: options.project === undefined ? { id: "project-1", name: "API" } : options.project,
    error: null,
  });
  const integrationsChain = createQueryChain({
    data: options.integrations ?? [],
    error: options.integrationsError ?? null,
  });
  const updateChain = createQueryChain({
    data: options.updatedProject ?? { id: "project-1", name: "Renamed" },
    error: options.updateError ?? null,
  });
  const deleteChain = createQueryChain({
    data: null,
    error: options.deleteError ?? null,
  });
  const projectsTable = {
    select: projectChain.select,
    eq: projectChain.eq,
    single: projectChain.single,
    update: vi.fn(() => updateChain),
    delete: vi.fn(() => deleteChain),
  };

  client.from = vi.fn((table: string) => {
    if (table === "chainthings_profiles") return profileChain as never;
    if (table === "chainthings_dev_projects") return projectsTable as never;
    if (table === "chainthings_integrations") return integrationsChain as never;
    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
  return { profileChain, projectChain, integrationsChain, projectsTable, updateChain, deleteChain };
}

describe("/api/dev-services/projects/[projectId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setupClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 401 for unauthenticated project requests", async () => {
    setupClient({ user: null });

    const response = await GET(createGetRequest("http://localhost/api/dev-services/projects/project-1"), projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when the project is missing or belongs to another tenant", async () => {
    setupClient({ project: null });

    const response = await GET(createGetRequest("http://localhost/api/dev-services/projects/project-1"), projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Project not found");
  });

  it("should get a project with integration webhook URLs scoped to the tenant", async () => {
    const { projectChain, integrationsChain } = setupClient({
      project: { id: "project-1", name: "API", metadata: {} },
      integrations: [
        {
          id: "integration-1",
          service: "github",
          label: "GitHub",
          status: "active",
          config: { external_user_id: "octo" },
        },
      ],
    });

    const response = await GET(createGetRequest("http://localhost/api/dev-services/projects/project-1"), projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: "project-1",
      name: "API",
      integrations: [
        {
          id: "integration-1",
          service: "github",
          label: "GitHub",
          status: "active",
          external_user_id: "octo",
          webhook_url: "http://localhost:3001/api/dev-services/webhooks/github/integration-1",
        },
      ],
    });
    expect(projectChain.eq).toHaveBeenCalledWith("id", "project-1");
    expect(projectChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-456");
    expect(integrationsChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-456");
    expect(integrationsChain.eq).toHaveBeenCalledWith("dev_project_id", "project-1");
  });

  it("should reject patch requests without updatable fields", async () => {
    const request = createJsonRequest("http://localhost/api/dev-services/projects/project-1", {
      ignored: true,
    });

    const response = await PATCH(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("No updatable fields provided");
  });

  it("should reject invalid patch names", async () => {
    const request = createJsonRequest("http://localhost/api/dev-services/projects/project-1", {
      name: "",
    });

    const response = await PATCH(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("name must be a non-empty string");
  });

  it("should update editable project fields for the current tenant", async () => {
    const { projectsTable, updateChain } = setupClient({
      updatedProject: { id: "project-1", name: "Renamed" },
    });
    const request = createJsonRequest("http://localhost/api/dev-services/projects/project-1", {
      name: "  Renamed  ",
      metadata: { team: "platform" },
    });

    const response = await PATCH(request, projectParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { id: "project-1", name: "Renamed" } });
    expect(projectsTable.update).toHaveBeenCalledWith({
      name: "Renamed",
      metadata: { team: "platform" },
      updated_at: expect.any(String),
    });
    expect(updateChain.eq).toHaveBeenCalledWith("id", "project-1");
    expect(updateChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-456");
  });

  it("should delete only a project owned by the current tenant", async () => {
    const { projectsTable, deleteChain } = setupClient();
    const request = createDeleteRequest("http://localhost/api/dev-services/projects/project-1", {});

    const response = await DELETE(request, projectParams());

    expect(response.status).toBe(204);
    expect(projectsTable.delete).toHaveBeenCalledOnce();
    expect(deleteChain.eq).toHaveBeenCalledWith("id", "project-1");
    expect(deleteChain.eq).toHaveBeenCalledWith("tenant_id", "tenant-456");
  });
});
