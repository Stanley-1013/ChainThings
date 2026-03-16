import {
  getDefaultProvider,
  getProviderConfig,
  type AiProvider,
} from "./providers";

export interface EmbeddingOptions {
  provider?: AiProvider;
  token?: string;
  tenantId?: string;
}

export async function generateEmbedding(
  text: string,
  options?: EmbeddingOptions
): Promise<number[]> {
  const provider = options?.provider ?? getDefaultProvider();
  const config = getProviderConfig(provider);
  const token = options?.token || config.defaultToken;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (config.supportsTenantHeader && options?.tenantId && config.tenantHeaderName) {
    headers[config.tenantHeaderName] = options.tenantId;
  }

  const url = `${config.baseUrl}/v1/embeddings`;
  const body = JSON.stringify({
    input: text,
    model: "text-embedding-3-small",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${provider} embedding error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return data.data?.[0]?.embedding ?? data.embedding ?? [];
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `${provider} embedding request timed out after ${config.timeoutMs}ms`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
