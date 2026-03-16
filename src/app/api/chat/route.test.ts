import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { chatCompletion } from "@/lib/openclaw/client";
import { createWorkflow } from "@/lib/n8n/client";
import { createMockSupabaseClient, mockProfile } from "@/__tests__/mocks/supabase";
import { mockChatResponse, mockN8nWorkflowResponse } from "@/__tests__/mocks/openclaw";
import { mockN8nWorkflow } from "@/__tests__/mocks/n8n";
import { createJsonRequest, getJsonResponse } from "@/__tests__/helpers";

const mockCreateClient = vi.mocked(createClient);
const mockChatCompletion = vi.mocked(chatCompletion);
const mockCreateWorkflow = vi.mocked(createWorkflow);

const BASE_URL = "http://localhost:3000/api/chat";

function setupAuthenticatedClient() {
  const client = createMockSupabaseClient();

  // Mock conversation insert
  const convInsertChain = {
    select: vi.fn(() => ({
      single: vi.fn(() => ({
        data: { id: "conv-1" },
        error: null,
      })),
    })),
  };

  // Mock message insert
  const msgInsertChain = {
    data: null,
    error: null,
  };

  // Mock message history select
  const historyChain = {
    eq: vi.fn(() => ({
      order: vi.fn(() => ({
        limit: vi.fn(() => ({
          data: [
            { role: "user", content: "Hello" },
          ],
          error: null,
        })),
      })),
    })),
  };

  // Mock workflow insert
  const workflowInsertChain = {
    data: null,
    error: null,
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
    if (table === "chainthings_conversations") {
      return {
        insert: vi.fn(() => convInsertChain),
      } as never;
    }
    if (table === "chainthings_messages") {
      return {
        insert: vi.fn(() => msgInsertChain),
        select: vi.fn(() => historyChain),
      } as never;
    }
    if (table === "chainthings_workflows") {
      return {
        insert: vi.fn(() => workflowInsertChain),
      } as never;
    }
    if (table === "chainthings_integrations") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => ({ data: null, error: null })),
            })),
          })),
        })),
      } as never;
    }
    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
  return client;
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 for unauthenticated user", async () => {
    const client = createMockSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as never);

    const request = createJsonRequest(BASE_URL, { message: "Hello" });
    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 400 when message is missing", async () => {
    const client = createMockSupabaseClient();
    mockCreateClient.mockResolvedValue(client as never);

    const request = createJsonRequest(BASE_URL, {});
    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Message is required");
  });

  it("should return 400 when message is not a string", async () => {
    const client = createMockSupabaseClient();
    mockCreateClient.mockResolvedValue(client as never);

    const request = createJsonRequest(BASE_URL, { message: 123 });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it("should return 404 when profile not found", async () => {
    const client = createMockSupabaseClient({ profile: null });
    mockCreateClient.mockResolvedValue(client as never);

    const request = createJsonRequest(BASE_URL, { message: "Hello" });
    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  it("should create a new conversation and return response", async () => {
    setupAuthenticatedClient();
    mockChatCompletion.mockResolvedValue(mockChatResponse("Hi there!"));

    const request = createJsonRequest(BASE_URL, { message: "Hello" });
    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.conversationId).toBe("conv-1");
    expect(body.message).toBe("Hi there!");
    expect(body.n8n).toBeNull();
  });

  it("should inject n8n system prompt when tool is n8n", async () => {
    setupAuthenticatedClient();
    mockChatCompletion.mockResolvedValue(mockChatResponse("I can help with workflows"));

    const request = createJsonRequest(BASE_URL, {
      message: "Create a workflow",
      tool: "n8n",
    });

    await POST(request);

    expect(mockChatCompletion).toHaveBeenCalledOnce();
    const callArgs = mockChatCompletion.mock.calls[0];
    expect(callArgs[0][0].role).toBe("system");
    expect(callArgs[0][0].content).toContain("n8n workflow assistant");
  });

  it("should parse n8n-workflow code block and create workflow", async () => {
    setupAuthenticatedClient();
    mockChatCompletion.mockResolvedValue(mockN8nWorkflowResponse("My Workflow"));
    mockCreateWorkflow.mockResolvedValue(mockN8nWorkflow("wf-1", "My Workflow"));

    const request = createJsonRequest(BASE_URL, {
      message: "Create a workflow",
      tool: "n8n",
    });
    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.n8n).toBeDefined();
    expect(body.n8n.name).toBe("My Workflow");
    expect(body.n8n.n8nWorkflowId).toBe("wf-1");
    expect(body.n8n.status).toBe("active");
  });

  it("should handle n8n API failure gracefully", async () => {
    setupAuthenticatedClient();
    mockChatCompletion.mockResolvedValue(mockN8nWorkflowResponse("My Workflow"));
    mockCreateWorkflow.mockRejectedValue(new Error("n8n unavailable"));

    const request = createJsonRequest(BASE_URL, {
      message: "Create a workflow",
      tool: "n8n",
    });
    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.n8n.status).toBe("pending");
    expect(body.n8n.n8nWorkflowId).toBeNull();
  });

  it("should return 502 when OpenClaw fails", async () => {
    setupAuthenticatedClient();
    mockChatCompletion.mockRejectedValue(new Error("OpenClaw timeout"));

    const request = createJsonRequest(BASE_URL, { message: "Hello" });
    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(502);
    expect(body.error).toBe("OpenClaw timeout");
  });
});
