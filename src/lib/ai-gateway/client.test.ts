import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.unmock("@/lib/ai-gateway");
vi.unmock("@/lib/ai-gateway/client");
vi.unmock("@/lib/ai-gateway/providers");

process.env.ZEROCLAW_GATEWAY_URL = "http://localhost:42617";
process.env.ZEROCLAW_GATEWAY_TOKEN = "zc-token";
process.env.ZEROCLAW_TIMEOUT_MS = "5000";
process.env.OPENCLAW_GATEWAY_URL = "http://localhost:18789";
process.env.OPENCLAW_GATEWAY_TOKEN = "oc-token";
process.env.OPENCLAW_TIMEOUT_MS = "5000";
process.env.DEFAULT_AI_PROVIDER = "zeroclaw";

import { chatCompletion, buildZeroClawPrompt } from "./client";

const originalFetch = globalThis.fetch;

describe("ai-gateway client", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("ZeroClaw provider", () => {
    it("sends request to /webhook with flattened prompt", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ response: "Hello!", model: "anthropic/claude-sonnet-4" }),
      });

      const result = await chatCompletion(
        [{ role: "user", content: "Hi" }],
        undefined,
        { provider: "zeroclaw" }
      );

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:42617/webhook");
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer zc-token");

      const body = JSON.parse(init.body);
      expect(body.message).toBe("Hi");

      expect(result.choices[0].message.content).toBe("Hello!");
      expect(result.choices[0].message.role).toBe("assistant");
      expect(result.id).toMatch(/^zc-/);
    });

    it("does not send x-tenant-id header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: "ok" }),
      });

      await chatCompletion(
        [{ role: "user", content: "Hi" }],
        undefined,
        { provider: "zeroclaw", tenantId: "t-123" }
      );

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers["x-tenant-id"]).toBeUndefined();
    });
  });

  describe("OpenClaw provider", () => {
    it("sends request to /v1/chat/completions with OpenAI format", async () => {
      const mockResponse = {
        id: "cmpl-1",
        choices: [
          { index: 0, message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" },
        ],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await chatCompletion(
        [{ role: "user", content: "Hi" }],
        "user-1",
        { provider: "openclaw", tenantId: "t-123" }
      );

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:18789/v1/chat/completions");
      expect(init.headers["x-tenant-id"]).toBe("t-123");

      const body = JSON.parse(init.body);
      expect(body.model).toBe("openclaw:main");
      expect(body.messages).toHaveLength(1);
      expect(body.stream).toBe(false);
      expect(body.user).toBe("user-1");

      expect(result.choices[0].message.content).toBe("Hello!");
    });
  });

  describe("error handling", () => {
    it("throws on non-ok response with provider name", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Server Error"),
      });

      await expect(
        chatCompletion([{ role: "user", content: "Hi" }], undefined, {
          provider: "zeroclaw",
        })
      ).rejects.toThrow("zeroclaw error 500: Server Error");
    });

    it("throws timeout error with provider name", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.reject(new DOMException("aborted", "AbortError"))
      );

      await expect(
        chatCompletion([{ role: "user", content: "Hi" }], undefined, {
          provider: "openclaw",
        })
      ).rejects.toThrow("openclaw request timed out after");
    });

    it("throws when requireTenantToken is set but no token", async () => {
      await expect(
        chatCompletion([{ role: "user", content: "Hi" }], undefined, {
          provider: "zeroclaw",
          requireTenantToken: true,
        })
      ).rejects.toThrow("Tenant-specific AI token required");
    });
  });
});

describe("buildZeroClawPrompt", () => {
  it("returns single user message as-is", () => {
    const result = buildZeroClawPrompt([{ role: "user", content: "Hello" }]);
    expect(result).toBe("Hello");
  });

  it("prepends system prompt to user message", () => {
    const result = buildZeroClawPrompt([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ]);
    expect(result).toBe("You are helpful.\n\nHello");
  });

  it("formats multi-turn as dialogue", () => {
    const result = buildZeroClawPrompt([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "How are you?" },
    ]);
    expect(result).toBe("User: Hi\n\nAssistant: Hello!\n\nUser: How are you?");
  });

  it("combines system prompt with multi-turn dialogue", () => {
    const result = buildZeroClawPrompt([
      { role: "system", content: "Be concise." },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "Bye" },
    ]);
    expect(result).toBe(
      "Be concise.\n\nUser: Hi\n\nAssistant: Hello!\n\nUser: Bye"
    );
  });

  it("joins multiple system prompts", () => {
    const result = buildZeroClawPrompt([
      { role: "system", content: "Rule 1" },
      { role: "system", content: "Rule 2" },
      { role: "user", content: "Go" },
    ]);
    expect(result).toBe("Rule 1\n\nRule 2\n\nGo");
  });
});
