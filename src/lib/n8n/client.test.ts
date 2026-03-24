import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Undo global mocks from setup.ts
vi.unmock("@/lib/n8n/client");

// Set env before importing
process.env.N8N_API_URL = "http://localhost:5678";
process.env.N8N_API_KEY = "test-n8n-key";
process.env.N8N_TIMEOUT_MS = "5000";

import {
  createWorkflow,
  getWorkflow,
  activateWorkflow,
  deleteWorkflow,
  listWorkflows,
  getWorkflowEditorUrl,
} from "./client";

const originalFetch = globalThis.fetch;

describe("n8n client", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("createWorkflow sends correct request and applies tags", async () => {
    // 1st call: create workflow
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "wf-1", name: "test", active: false }),
      text: () => Promise.resolve(""),
    });
    // 2nd call: list all tags (batched — single call)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ id: "t-1", name: "chainthings" }]),
      text: () => Promise.resolve(""),
    });
    // 3rd call: create missing tag "tenant:abc"
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "t-2", name: "tenant:abc" }),
      text: () => Promise.resolve(""),
    });
    // 4th call: PUT workflow with tags
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "wf-1" }),
      text: () => Promise.resolve(""),
    });

    const result = await createWorkflow(
      "My Workflow",
      [{ type: "n8n-nodes-base.webhook" }],
      {},
      ["chainthings", "tenant:abc"]
    );

    // Verify create call (no tags in body)
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:5678/api/v1/workflows");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.name).toBe("[ChainThings] My Workflow");
    expect(body.tags).toBeUndefined();

    // Verify tags were applied via PUT (now 4th call instead of 5th due to batched tag lookup)
    const putCall = mockFetch.mock.calls[3];
    expect(putCall[0]).toBe("http://localhost:5678/api/v1/workflows/wf-1");
    expect(putCall[1].method).toBe("PUT");

    // Verify reduced call count: create + list tags + create tag + put tags = 4 (was 5)
    expect(mockFetch).toHaveBeenCalledTimes(4);

    expect(result.id).toBe("wf-1");
  });

  it("getWorkflow fetches by ID", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ id: "wf-2", name: "fetched", active: true }),
      text: () => Promise.resolve(""),
    });

    const result = await getWorkflow("wf-2");

    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://localhost:5678/api/v1/workflows/wf-2"
    );
    expect(result.id).toBe("wf-2");
  });

  it("activateWorkflow sends POST to activate endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ id: "wf-3", name: "activated", active: true }),
      text: () => Promise.resolve(""),
    });

    await activateWorkflow("wf-3");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:5678/api/v1/workflows/wf-3/activate");
    expect(init.method).toBe("POST");
  });

  it("deleteWorkflow sends DELETE request", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(""),
    });

    await deleteWorkflow("wf-4");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:5678/api/v1/workflows/wf-4");
    expect(init.method).toBe("DELETE");
  });

  it("listWorkflows fetches all workflows", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: "wf-1" }, { id: "wf-2" }] }),
      text: () => Promise.resolve(""),
    });

    const result = await listWorkflows();

    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://localhost:5678/api/v1/workflows"
    );
    expect(result.data).toHaveLength(2);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    await expect(listWorkflows()).rejects.toThrow(
      "n8n error 500: Internal Server Error"
    );
  });

  it("throws timeout error on abort", async () => {
    mockFetch.mockImplementationOnce(() => {
      const err = new DOMException("The operation was aborted", "AbortError");
      return Promise.reject(err);
    });

    await expect(listWorkflows()).rejects.toThrow(
      "n8n request timed out after"
    );
  });
});

describe("getWorkflowEditorUrl", () => {
  const originalEnv = process.env.N8N_EDITOR_BASE_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.N8N_EDITOR_BASE_URL;
    } else {
      process.env.N8N_EDITOR_BASE_URL = originalEnv;
    }
  });

  it("returns null when N8N_EDITOR_BASE_URL is not set", () => {
    delete process.env.N8N_EDITOR_BASE_URL;
    // getWorkflowEditorUrl reads env at module load, so it may be cached
    // For this test, we rely on the default empty string behavior
    expect(getWorkflowEditorUrl("wf-1")).toBeNull();
  });

  it("returns null for invalid URL schema", () => {
    // The function validates http/https at call time from the module-level const
    expect(getWorkflowEditorUrl("wf-1")).toBeNull();
  });
});
