import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { chatCompletion } from "@/lib/ai-gateway";
import { createWorkflow } from "@/lib/n8n/client";
import { createMockSupabaseClient, mockProfile } from "@/__tests__/mocks/supabase";
import { mockJsonWorkflowResponse, mockChatResponse } from "@/__tests__/mocks/openclaw";
import { mockN8nWorkflow } from "@/__tests__/mocks/n8n";
import { createJsonRequest, getJsonResponse } from "@/__tests__/helpers";

const mockCreateClient = vi.mocked(createClient);
const mockChatCompletion = vi.mocked(chatCompletion);
const mockCreateWorkflow = vi.mocked(createWorkflow);

const BASE_URL = "http://localhost:3000/api/workflows/generate";

function setupClient() {
  const client = createMockSupabaseClient();

  const workflowRecord = {
    id: "wf-record-1",
    tenant_id: "tenant-456",
    name: "Test prompt",
    prompt: "Create a test workflow",
    status: "generating",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };

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
    if (table === "chainthings_workflows") {
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() => ({ data: workflowRecord, error: null })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({ error: null })),
        })),
      } as never;
    }
    if (table === "chainthings_integrations") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(() => ({ data: [], error: null })),
          })),
        })),
      } as never;
    }
    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
  return client;
}

describe("POST /api/workflows/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 for unauthenticated user", async () => {
    const client = createMockSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as never);

    const request = createJsonRequest(BASE_URL, { prompt: "Create workflow" });
    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  it("should return 400 when prompt is missing", async () => {
    const client = createMockSupabaseClient();
    mockCreateClient.mockResolvedValue(client as never);

    const request = createJsonRequest(BASE_URL, {});
    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Prompt is required");
  });

  it("should return 404 when profile not found", async () => {
    const client = createMockSupabaseClient({ profile: null });
    mockCreateClient.mockResolvedValue(client as never);

    const request = createJsonRequest(BASE_URL, { prompt: "Create workflow" });
    const response = await POST(request);

    expect(response.status).toBe(404);
  });

  it("should generate workflow and create in n8n", async () => {
    setupClient();
    mockChatCompletion.mockResolvedValue(mockJsonWorkflowResponse("Email Summary"));
    mockCreateWorkflow.mockResolvedValue(mockN8nWorkflow("wf-1", "Email Summary"));

    const request = createJsonRequest(BASE_URL, { prompt: "Create email summary workflow" });
    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.workflow.name).toBe("Email Summary");
    expect(body.workflow.status).toBe("active");
    expect(body.workflow.n8n_workflow_id).toBe("wf-1");
  });

  it("should save as pending when n8n is unavailable", async () => {
    setupClient();
    mockChatCompletion.mockResolvedValue(mockJsonWorkflowResponse("Email Summary"));
    mockCreateWorkflow.mockRejectedValue(new Error("n8n unavailable"));

    const request = createJsonRequest(BASE_URL, { prompt: "Create email summary workflow" });
    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.workflow.status).toBe("pending");
  });

  it("should return 500 when AI returns no JSON", async () => {
    setupClient();
    mockChatCompletion.mockResolvedValue(mockChatResponse("I cannot generate that workflow."));

    const request = createJsonRequest(BASE_URL, { prompt: "Create workflow" });
    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("Workflow generation failed");
  });

  it("should return 500 when OpenClaw fails", async () => {
    setupClient();
    mockChatCompletion.mockRejectedValue(new Error("Service unavailable"));

    const request = createJsonRequest(BASE_URL, { prompt: "Create workflow" });
    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("Workflow generation failed");
  });
});
