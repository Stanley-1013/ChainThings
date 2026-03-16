export type AiProvider = "zeroclaw" | "openclaw";

export interface ProviderConfig {
  name: AiProvider;
  baseUrl: string;
  defaultToken?: string;
  defaultModel: string;
  timeoutMs: number;
  chatEndpoint: string;
  requestFormat: "zeroclaw" | "openai";
  supportsTenantHeader: boolean;
  tenantHeaderName?: string;
}

function env(name: string): string | undefined {
  return process.env[name] || undefined;
}

function envTimeout(name: string, fallback: number): number {
  const val = Number(process.env[name]);
  return Number.isFinite(val) && val > 0 ? val : fallback;
}

const configs: Record<AiProvider, () => ProviderConfig | undefined> = {
  zeroclaw: () => {
    const url = env("ZEROCLAW_GATEWAY_URL");
    if (!url) return undefined;
    return {
      name: "zeroclaw",
      baseUrl: url,
      defaultToken: env("ZEROCLAW_GATEWAY_TOKEN"),
      defaultModel: env("ZEROCLAW_MODEL") || "zeroclaw:main",
      timeoutMs: envTimeout("ZEROCLAW_TIMEOUT_MS", 30_000),
      chatEndpoint: "/webhook",
      requestFormat: "zeroclaw",
      supportsTenantHeader: false,
    };
  },
  openclaw: () => {
    const url = env("OPENCLAW_GATEWAY_URL");
    if (!url) return undefined;
    return {
      name: "openclaw",
      baseUrl: url,
      defaultToken: env("OPENCLAW_GATEWAY_TOKEN"),
      defaultModel: env("OPENCLAW_MODEL") || "openclaw:main",
      timeoutMs: envTimeout("OPENCLAW_TIMEOUT_MS", 30_000),
      chatEndpoint: "/v1/chat/completions",
      requestFormat: "openai",
      supportsTenantHeader: true,
      tenantHeaderName: "x-tenant-id",
    };
  },
};

export function getDefaultProvider(): AiProvider {
  const explicit = env("DEFAULT_AI_PROVIDER");
  if (explicit === "openclaw" || explicit === "zeroclaw") return explicit;
  return "zeroclaw";
}

export function getProviderConfig(provider: AiProvider): ProviderConfig {
  const cfg = configs[provider]();
  if (!cfg) {
    throw new Error(
      `AI provider "${provider}" is not configured. Set ${provider === "zeroclaw" ? "ZEROCLAW_GATEWAY_URL" : "OPENCLAW_GATEWAY_URL"} in your environment.`
    );
  }
  return cfg;
}
