import {
  getDefaultProvider,
  getProviderConfig,
  type AiProvider,
} from "./providers";

export interface EmbeddingOptions {
  provider?: AiProvider;
  token?: string;
  tenantId?: string;
  model?: string;
  signal?: AbortSignal;
}

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export async function generateEmbeddings(
  input: string[],
  options?: EmbeddingOptions
): Promise<number[][]> {
  if (input.length === 0) return [];

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
    input,
    model: options?.model || DEFAULT_EMBEDDING_MODEL,
  });

  const embeddingTimeout = config.embeddingTimeoutMs ?? config.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), embeddingTimeout);
  if (options?.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
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
    if (Array.isArray(data.data)) {
      return data.data
        .sort((a: { index?: number }, b: { index?: number }) => (a.index ?? 0) - (b.index ?? 0))
        .map((row: { embedding?: number[] }) => row.embedding ?? []);
    }
    if (Array.isArray(data.embedding)) {
      return [data.embedding];
    }
    return [];
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

export async function generateEmbedding(
  text: string,
  options?: EmbeddingOptions
): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text], options);
  return embedding ?? [];
}
