import { createHash } from "crypto";

export interface Chunk {
  index: number;
  content: string;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

const MAX_CHUNK_CHARS = 800;
const OVERLAP_CHARS = 100;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function contentHash(title: string | null, content: string | null): string {
  return createHash("md5")
    .update((title ?? "") + (content ?? ""))
    .digest("hex");
}

function splitByStructure(text: string): string[] {
  // Split on markdown headings, double newlines, or speaker labels
  const sections = text.split(/(?=^#{1,3}\s|\n{2,}|\n(?=[A-Z][a-z]+ ?:))/m);
  return sections.map((s) => s.trim()).filter(Boolean);
}

function splitWithOverlap(text: string, maxChars: number, overlapChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - overlapChars;
  }
  return chunks;
}

export function chunkContent(
  title: string | null,
  content: string | null,
  metadata?: Record<string, unknown>
): Chunk[] {
  const text = [title, content].filter(Boolean).join("\n\n");
  if (!text) return [];

  const chunks: Chunk[] = [];
  const sections = splitByStructure(text);

  let currentChunk = "";
  let chunkIndex = 0;

  for (const section of sections) {
    if (currentChunk.length + section.length > MAX_CHUNK_CHARS && currentChunk) {
      // Flush current chunk
      for (const sub of splitWithOverlap(currentChunk, MAX_CHUNK_CHARS, OVERLAP_CHARS)) {
        chunks.push({
          index: chunkIndex++,
          content: sub,
          tokenCount: estimateTokens(sub),
          metadata: metadata ?? {},
        });
      }
      currentChunk = "";
    }
    currentChunk += (currentChunk ? "\n\n" : "") + section;
  }

  // Flush remaining
  if (currentChunk) {
    for (const sub of splitWithOverlap(currentChunk, MAX_CHUNK_CHARS, OVERLAP_CHARS)) {
      chunks.push({
        index: chunkIndex++,
        content: sub,
        tokenCount: estimateTokens(sub),
        metadata: metadata ?? {},
      });
    }
  }

  return chunks;
}
