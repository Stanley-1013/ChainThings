export interface EmbeddingOptions {
  signal?: AbortSignal;
}

const JINA_API_KEY = process.env.JINA_API_KEY || "";
const JINA_MODEL = "jina-embeddings-v3";
const JINA_URL = "https://api.jina.ai/v1/embeddings";
const EMBEDDING_TIMEOUT_MS = parseInt(process.env.RAG_TIMEOUT_MS || "10000", 10);

export async function generateEmbeddings(
  input: string[],
  options?: EmbeddingOptions
): Promise<number[][]> {
  if (input.length === 0) return [];
  if (!JINA_API_KEY) throw new Error("JINA_API_KEY not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);
  if (options?.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(JINA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JINA_API_KEY}`,
      },
      body: JSON.stringify({ input, model: JINA_MODEL }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Jina embedding error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    if (Array.isArray(data.data)) {
      return data.data
        .sort((a: { index?: number }, b: { index?: number }) => (a.index ?? 0) - (b.index ?? 0))
        .map((row: { embedding?: number[] }) => row.embedding ?? []);
    }
    return [];
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Jina embedding request timed out after ${EMBEDDING_TIMEOUT_MS}ms`);
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
