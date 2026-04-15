export interface EmbeddingOptions {
  signal?: AbortSignal;
}

const EMBEDDING_URL = process.env.EMBEDDING_URL || "http://localhost:31968/v1/embeddings";
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || "";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "Qwen3-Embedding-8B-4bit-DWQ";
const EMBEDDING_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS || "1024", 10);
const EMBEDDING_TIMEOUT_MS = parseInt(process.env.RAG_TIMEOUT_MS || "30000", 10);

export async function generateEmbeddings(
  input: string[],
  options?: EmbeddingOptions
): Promise<number[][]> {
  if (input.length === 0) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);
  if (options?.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (EMBEDDING_API_KEY) {
      headers["Authorization"] = `Bearer ${EMBEDDING_API_KEY}`;
    }

    const res = await fetch(EMBEDDING_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        input,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Embedding error ${res.status}: ${errText}`);
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
      throw new Error(`Embedding request timed out after ${EMBEDDING_TIMEOUT_MS}ms`);
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
