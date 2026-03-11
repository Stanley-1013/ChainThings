import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { createWorkflow, activateWorkflow } from "@/lib/n8n/client";
import { generateHedyWebhookWorkflow } from "@/lib/n8n/templates/hedy-webhook";
import { createMockSupabaseClient, mockProfile } from "@/__tests__/mocks/supabase";
import { mockN8nWorkflow } from "@/__tests__/mocks/n8n";
import { getJsonResponse } from "@/__tests__/helpers";

const mockCreateClient = vi.mocked(createClient);
const mockCreateWorkflow = vi.mocked(createWorkflow);
const mockActivateWorkflow = vi.mocked(activateWorkflow);
const mockGenerateTemplate = vi.mocked(generateHedyWebhookWorkflow);

function setupClient(integration?: { id: string; config: Record<string, unknown> } | null) {
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

  it("should return existing workflow if already created", async () => {
    setupClient({ id: "int-1", config: { n8n_workflow_id: "wf-existing" } });

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data.alreadyExists).toBe(true);
    expect(body.data.n8nWorkflowId).toBe("wf-existing");
    expect(body.data.webhookUrl).toContain("hedy-tenant-456");
  });

  it("should create and activate workflow successfully", async () => {
    setupClient({ id: "int-1", config: {} });
    mockCreateWorkflow.mockResolvedValue(mockN8nWorkflow("wf-new", "Hedy Webhook"));
    mockActivateWorkflow.mockResolvedValue({ ...mockN8nWorkflow("wf-new"), active: true });

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data.n8nWorkflowId).toBe("wf-new");
    expect(body.data.webhookUrl).toContain("hedy-tenant-456");
    expect(mockCreateWorkflow).toHaveBeenCalledOnce();
    expect(mockActivateWorkflow).toHaveBeenCalledOnce();
  });

  it("should still succeed when activation fails", async () => {
    setupClient({ id: "int-1", config: {} });
    mockCreateWorkflow.mockResolvedValue(mockN8nWorkflow("wf-new"));
    mockActivateWorkflow.mockRejectedValue(new Error("Activation failed"));

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.data.n8nWorkflowId).toBe("wf-new");
  });

  it("should return 502 when workflow creation fails", async () => {
    setupClient({ id: "int-1", config: {} });
    mockCreateWorkflow.mockRejectedValue(new Error("n8n down"));

    const response = await POST();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(502);
    expect(body.error).toContain("n8n down");
  });
});
