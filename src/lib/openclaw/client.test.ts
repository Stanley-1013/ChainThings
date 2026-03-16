import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Undo global mock from setup.ts
vi.unmock("@/lib/openclaw/client");

// Set env before importing
process.env.OPENCLAW_GATEWAY_URL = "http://localhost:18789";
process.env.OPENCLAW_GATEWAY_TOKEN = "test-token";
process.env.OPENCLAW_TIMEOUT_MS = "5000";

import { chatCompletion } from "./client";

const originalFetch = globalThis.fetch;

describe("openclaw client", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const mockResponse = {
    id: "cmpl-1",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Hello!" },
        finish_reason: "stop",
      },
    ],
  };

  it("sends chat completion request with default token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
      text: () => Promise.resolve(""),
    });

    const result = await chatCompletion([{ role: "user", content: "Hi" }]);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:18789/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(result.choices[0].message.content).toBe("Hello!");
  });

  it("uses tenant-specific token when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
      text: () => Promise.resolve(""),
    });

    await chatCompletion(
      [{ role: "user", content: "Hi" }],
      "user-1",
      { token: "tenant-token", tenantId: "t-123" }
    );

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer tenant-token");
    expect(init.headers["x-tenant-id"]).toBe("t-123");
  });

  it("includes userId in request body when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
      text: () => Promise.resolve(""),
    });

    await chatCompletion([{ role: "user", content: "Hi" }], "user-42");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.user).toBe("user-42");
  });

  it("throws when requireTenantToken is set but no token provided", async () => {
    await expect(
      chatCompletion(
        [{ role: "user", content: "Hi" }],
        undefined,
        { requireTenantToken: true }
      )
    ).rejects.toThrow("Tenant-specific OpenClaw token required");
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Rate limited"),
    });

    await expect(
      chatCompletion([{ role: "user", content: "Hi" }])
    ).rejects.toThrow("OpenClaw error 429: Rate limited");
  });

  it("throws timeout error on abort", async () => {
    mockFetch.mockImplementationOnce(() => {
      const err = new DOMException("The operation was aborted", "AbortError");
      return Promise.reject(err);
    });

    await expect(
      chatCompletion([{ role: "user", content: "Hi" }])
    ).rejects.toThrow("OpenClaw request timed out after");
  });
});
