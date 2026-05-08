import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { createDevServiceClient } from "@/lib/dev-services/factory";
import { getAction, validateActionInput } from "@/lib/dev-services/action-registry";
import { consumeApprovalToken } from "@/lib/dev-services/approval";
import {
  createMockSupabaseClient,
  mockProfile,
  mockUser,
} from "@/__tests__/mocks/supabase";
import { createJsonRequest, getJsonResponse } from "@/__tests__/helpers";

vi.mock("@/lib/dev-services/factory", () => ({
  createDevServiceClient: vi.fn(),
}));

vi.mock("@/lib/dev-services/action-registry", () => ({
  getAction: vi.fn(),
  validateActionInput: vi.fn(),
}));

vi.mock("@/lib/dev-services/approval", () => ({
  consumeApprovalToken: vi.fn(),
}));

const mockCreateClient = vi.mocked(createClient);
const mockCreateDevServiceClient = vi.mocked(createDevServiceClient);
const mockGetAction = vi.mocked(getAction);
const mockValidateActionInput = vi.mocked(validateActionInput);
const mockConsumeApprovalToken = vi.mocked(consumeApprovalToken);

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

function setupAction(options: {
  requiresApproval?: boolean;
  requiredCapability?: string;
  validation?: { success: true; data: Record<string, unknown> } | { success: false; error: string };
  handlerResult?: unknown;
} = {}) {
  const handler = vi.fn(async () => options.handlerResult ?? { ok: true });
  mockGetAction.mockReturnValue({
    requiredCapability: options.requiredCapability ?? "issues",
    requiresApproval: options.requiresApproval ?? false,
    handler,
  } as never);
  mockValidateActionInput.mockReturnValue(
    options.validation ?? { success: true, data: { title: "Issue" } },
  );
  return { handler };
}

describe("/api/dev-services/actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setupClient();
    setupAction();
    mockCreateDevServiceClient.mockResolvedValue({
      capabilities: ["issues", "summary"],
    } as never);
    mockConsumeApprovalToken.mockResolvedValue({
      tokenId: "approval-1",
      tenantId: "tenant-456",
      action: "approved_action",
      paramsHash: "hash",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 401 for unauthenticated action requests", async () => {
    setupClient({ user: null });
    const request = createJsonRequest("http://localhost/api/dev-services/actions", {
      projectId: "project-1",
      service: "github",
      action: "create_issue",
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when the project is outside the tenant", async () => {
    setupClient({ project: null });
    const request = createJsonRequest("http://localhost/api/dev-services/actions", {
      projectId: "project-1",
      service: "github",
      action: "create_issue",
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Project not found");
  });

  it("should reject malformed action payloads", async () => {
    const request = createJsonRequest("http://localhost/api/dev-services/actions", {
      projectId: "project-1",
      service: "github",
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("projectId, service and action required");
  });

  it("should reject unknown actions", async () => {
    mockGetAction.mockReturnValue(null as never);
    const request = createJsonRequest("http://localhost/api/dev-services/actions", {
      projectId: "project-1",
      service: "github",
      action: "unknown_action",
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Unknown action: unknown_action");
  });

  it("should reject params that fail action validation", async () => {
    setupAction({ validation: { success: false, error: "title is required" } });
    const request = createJsonRequest("http://localhost/api/dev-services/actions", {
      projectId: "project-1",
      service: "github",
      action: "create_issue",
      params: {},
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("title is required");
  });

  it("should reject unsupported service capabilities", async () => {
    setupAction({ requiredCapability: "code_review" });
    mockCreateDevServiceClient.mockResolvedValue({ capabilities: ["issues"] } as never);
    const request = createJsonRequest("http://localhost/api/dev-services/actions", {
      projectId: "project-1",
      service: "jira",
      action: "review_pr",
      params: { pr: 1 },
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("jira does not support code_review");
  });

  it("should run a valid action with a tenant-scoped client", async () => {
    const { handler } = setupAction({ handlerResult: { issueId: "ISSUE-1" } });
    const request = createJsonRequest("http://localhost/api/dev-services/actions", {
      projectId: "project-1",
      service: "github",
      action: "create_issue",
      params: { title: "Issue" },
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { issueId: "ISSUE-1" } });
    expect(mockCreateDevServiceClient).toHaveBeenCalledWith("tenant-456", "project-1", "github");
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ capabilities: ["issues", "summary"] }),
      "tenant-456",
      "project-1",
      { title: "Issue" },
    );
  });

  it("should require approval tokens for destructive actions", async () => {
    setupAction({ requiresApproval: true });
    const request = createJsonRequest("http://localhost/api/dev-services/actions", {
      projectId: "project-1",
      service: "github",
      action: "delete_issue",
      params: { title: "Issue" },
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(403);
    expect(body.error).toBe("This action requires approval. Provide approvalToken.");
  });

  it("should run workflow actions without creating a single-service client", async () => {
    const { handler } = setupAction({ handlerResult: { workflowId: "wf-1" } });
    const request = createJsonRequest("http://localhost/api/dev-services/actions", {
      projectId: "project-1",
      service: "github",
      action: "execute_workflow",
      params: { title: "Issue" },
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { workflowId: "wf-1" } });
    expect(mockCreateDevServiceClient).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(null, "tenant-456", "project-1", { title: "Issue" });
  });

  it("should return generic error message when action throws (B8 — no internal leak)", async () => {
    setupAction();
    mockCreateDevServiceClient.mockRejectedValue(new Error("db connection secret details"));
    const request = createJsonRequest("http://localhost/api/dev-services/actions", {
      projectId: "project-1",
      service: "github",
      action: "create_issue",
      params: { title: "Issue" },
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    // Must NOT expose the raw internal error message to the client
    expect(body.error).toBe("Action failed. Check server logs.");
    expect(body.error).not.toContain("db connection secret details");
  });
});
