import { describe, it, expect, vi } from "vitest";

vi.unmock("@/lib/ai-gateway");
vi.unmock("@/lib/ai-gateway/providers");

process.env.ZEROCLAW_GATEWAY_URL = "http://localhost:42617";
process.env.ZEROCLAW_GATEWAY_TOKEN = "zc-token";
process.env.OPENCLAW_GATEWAY_URL = "http://localhost:18789";
process.env.OPENCLAW_GATEWAY_TOKEN = "oc-token";

import { getDefaultProvider, getProviderConfig } from "./providers";

describe("providers", () => {
  describe("getDefaultProvider", () => {
    it("returns zeroclaw by default", () => {
      delete process.env.DEFAULT_AI_PROVIDER;
      expect(getDefaultProvider()).toBe("zeroclaw");
    });

    it("respects DEFAULT_AI_PROVIDER env", () => {
      process.env.DEFAULT_AI_PROVIDER = "openclaw";
      expect(getDefaultProvider()).toBe("openclaw");
      process.env.DEFAULT_AI_PROVIDER = "zeroclaw";
    });
  });

  describe("getProviderConfig", () => {
    it("returns zeroclaw config with /webhook endpoint", () => {
      const cfg = getProviderConfig("zeroclaw");
      expect(cfg.name).toBe("zeroclaw");
      expect(cfg.chatEndpoint).toBe("/webhook");
      expect(cfg.requestFormat).toBe("zeroclaw");
      expect(cfg.supportsTenantHeader).toBe(false);
      expect(cfg.baseUrl).toBe("http://localhost:42617");
    });

    it("returns openclaw config with /v1/chat/completions endpoint", () => {
      const cfg = getProviderConfig("openclaw");
      expect(cfg.name).toBe("openclaw");
      expect(cfg.chatEndpoint).toBe("/v1/chat/completions");
      expect(cfg.requestFormat).toBe("openai");
      expect(cfg.supportsTenantHeader).toBe(true);
      expect(cfg.tenantHeaderName).toBe("x-tenant-id");
    });

    it("throws when provider URL is not set", () => {
      const saved = process.env.ZEROCLAW_GATEWAY_URL;
      delete process.env.ZEROCLAW_GATEWAY_URL;
      expect(() => getProviderConfig("zeroclaw")).toThrow(
        'AI provider "zeroclaw" is not configured'
      );
      process.env.ZEROCLAW_GATEWAY_URL = saved;
    });

    it("includes chatTimeoutMs and embeddingTimeoutMs", () => {
      const cfg = getProviderConfig("zeroclaw");
      expect(cfg.chatTimeoutMs).toBeGreaterThanOrEqual(30_000);
      expect(cfg.embeddingTimeoutMs).toBeGreaterThan(0);
      expect(cfg.chatTimeoutMs).not.toBe(cfg.embeddingTimeoutMs);
    });

    it("chatTimeoutMs defaults to at least 60s for zeroclaw", () => {
      const cfg = getProviderConfig("zeroclaw");
      expect(cfg.chatTimeoutMs).toBeGreaterThanOrEqual(60_000);
    });

    it("embeddingTimeoutMs defaults to 10s", () => {
      const cfg = getProviderConfig("zeroclaw");
      expect(cfg.embeddingTimeoutMs).toBe(10_000);
    });
  });
});
