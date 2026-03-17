import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import {
  createWorkflow,
  activateWorkflow,
  getWorkflow,
  deleteWorkflow,
} from "@/lib/n8n/client";
import { generateHedyWebhookWorkflow } from "@/lib/n8n/templates/hedy-webhook";
import {
  createMockSupabaseClient,
  mockProfile,
} from "@/__tests__/mocks/supabase";
import { mockN8nWorkflow, mockActivatedWorkflow } from "@/__tests__/mocks/n8n";
import { getJsonResponse } from "@/__tests__/helpers";

const mockCreateClient = vi.mocked(createClient);
const mockCreateWorkflow = vi.mocked(createWorkflow);
const mockActivateWorkflow = vi.mocked(activateWorkflow);
const mockGetWorkflow = vi.mocked(getWorkflow);
const mockDeleteWorkflow = vi.mocked(deleteWorkflow);
const mockGenerateTemplate = vi.mocked(generateHedyWebhookWorkflow);

function setupClient(
  integration?: { id: string; config: Record<string, unknown> } | null
) {
  const client = createMockSupabaseClient();

  client.from = vi.fn((table: string) => {
    if (table === "chainthings_profiles") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => ({ data: mockProfile, error: null })),
          })),
        })),
      } as never;
    }
    if (table === "chainthings_integrations") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => ({ data: integration, error: null })),
            })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({ error: null })),
        })),
      } as never;
    }
    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
  return client;
}

describe("POST /api/integrations/hedy/setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateTemplate.mockReturnValue({
      name: "Hedy Webhook",
      nodes: [],
      connections: {},
    } as never);
  });

  it("should return 401 for unauthenticated user", async () => {
    const client = createMockSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as never);

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when profile not found", async () => {
    const client = createMockSupabaseClient({ profile: null });
    mockCreateClient.mockResolvedValue(client as never);

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  it("should return 400 when hedy integration does not exist", async () => {
    setupClient(null);

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toContain("Hedy API key");
  });

  it("should return existing workflow if active in n8n", async () => {
    setupClient({ id: "int-1", config: { n8n_workflow_id: "wf-existing" } });
    mockGetWorkflow.mockResolvedValue(
      mockActivatedWorkflow("wf-existing", "Hedy")
    );

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data.alreadyExists).toBe(true);
    expect(body.data.active).toBe(true);
    expect(body.data.n8nWorkflowId).toBe("wf-existing");
    expect(body.data.webhookUrl).toContain("hedy-tenant-456");
    expect(mockGetWorkflow).toHaveBeenCalledWith("wf-existing");
  });

  it("should reactivate inactive existing workflow", async () => {
    setupClient({ id: "int-1", config: { n8n_workflow_id: "wf-inactive" } });
    mockGetWorkflow.mockResolvedValue(mockN8nWorkflow("wf-inactive", "Hedy"));
    mockActivateWorkflow.mockResolvedValue(
      mockActivatedWorkflow("wf-inactive")
    );

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data.reactivated).toBe(true);
    expect(body.data.active).toBe(true);
    expect(mockActivateWorkflow).toHaveBeenCalledWith("wf-inactive");
  });

  it("should return 502 when reactivation of existing workflow fails", async () => {
    setupClient({ id: "int-1", config: { n8n_workflow_id: "wf-inactive" } });
    mockGetWorkflow.mockResolvedValue(mockN8nWorkflow("wf-inactive", "Hedy"));
    mockActivateWorkflow.mockRejectedValue(new Error("n8n permission denied"));

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(502);
    expect(body.error).toContain("reactivation failed");
    // Should NOT clear the workflow ID or create a new one
    expect(mockCreateWorkflow).not.toHaveBeenCalled();
  });

  it("should recreate workflow when existing one is gone from n8n", async () => {
    setupClient({ id: "int-1", config: { n8n_workflow_id: "wf-gone" } });
    mockGetWorkflow.mockRejectedValue(new Error("not found"));
    mockCreateWorkflow.mockResolvedValue(mockN8nWorkflow("wf-new"));
    mockActivateWorkflow.mockResolvedValue(mockActivatedWorkflow("wf-new"));

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data.n8nWorkflowId).toBe("wf-new");
    expect(mockCreateWorkflow).toHaveBeenCalledOnce();
  });

  it("should prefer N8N_WEBHOOK_URL over N8N_API_URL for webhook URL", async () => {
    process.env.N8N_WEBHOOK_URL = "https://public.example.com";
    process.env.N8N_API_URL = "http://internal:5678";
    setupClient({ id: "int-1", config: { n8n_workflow_id: "wf-1" } });
    mockGetWorkflow.mockResolvedValue(mockActivatedWorkflow("wf-1"));

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(body.data.webhookUrl).toContain(
      "https://public.example.com/webhook/"
    );
    process.env.N8N_WEBHOOK_URL = "";
  });

  it("should fall back to N8N_API_URL when N8N_WEBHOOK_URL is not set", async () => {
    process.env.N8N_WEBHOOK_URL = "";
    process.env.N8N_API_URL = "http://n8n-internal:5678";
    setupClient({ id: "int-1", config: { n8n_workflow_id: "wf-1" } });
    mockGetWorkflow.mockResolvedValue(mockActivatedWorkflow("wf-1"));

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(body.data.webhookUrl).toContain(
      "http://n8n-internal:5678/webhook/"
    );
  });

  it("should strip trailing slashes from webhook URL", async () => {
    process.env.N8N_WEBHOOK_URL = "https://public.example.com/";
    setupClient({ id: "int-1", config: { n8n_workflow_id: "wf-1" } });
    mockGetWorkflow.mockResolvedValue(mockActivatedWorkflow("wf-1"));

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(body.data.webhookUrl).not.toContain("//webhook");
    expect(body.data.webhookUrl).toContain(
      "https://public.example.com/webhook/"
    );
    process.env.N8N_WEBHOOK_URL = "";
  });

  it("should create and activate workflow successfully", async () => {
    setupClient({ id: "int-1", config: {} });
    mockCreateWorkflow.mockResolvedValue(
      mockN8nWorkflow("wf-new", "Hedy Webhook")
    );
    mockActivateWorkflow.mockResolvedValue({
      ...mockN8nWorkflow("wf-new"),
      active: true,
    });

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data.n8nWorkflowId).toBe("wf-new");
    expect(body.data.active).toBe(true);
    expect(body.data.webhookUrl).toContain("hedy-tenant-456");
    expect(mockCreateWorkflow).toHaveBeenCalledOnce();
    expect(mockActivateWorkflow).toHaveBeenCalledOnce();
  });

  it("should return 502 and cleanup when activation fails", async () => {
    setupClient({ id: "int-1", config: {} });
    mockCreateWorkflow.mockResolvedValue(mockN8nWorkflow("wf-new"));
    mockActivateWorkflow.mockRejectedValue(new Error("Activation failed"));
    mockDeleteWorkflow.mockResolvedValue(undefined);

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(502);
    expect(body.error).toContain("activation failed");
    expect(mockDeleteWorkflow).toHaveBeenCalledWith("wf-new");
  });

  it("should return 502 when workflow creation fails", async () => {
    setupClient({ id: "int-1", config: {} });
    mockCreateWorkflow.mockRejectedValue(new Error("n8n down"));

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(502);
    expect(body.error).toContain("Failed to create n8n workflow");
  });

  it("should pass tenant tags to createWorkflow", async () => {
    setupClient({ id: "int-1", config: {} });
    mockCreateWorkflow.mockResolvedValue(mockN8nWorkflow("wf-new"));
    mockActivateWorkflow.mockResolvedValue(mockActivatedWorkflow("wf-new"));

    await POST();

    expect(mockCreateWorkflow).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.any(Object),
      ["chainthings", "tenant:tenant-456"]
    );
  });
});
