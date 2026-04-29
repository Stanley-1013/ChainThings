import { describe, expect, it } from "vitest";
import { chunkContent, contentHash } from "./chunker";

describe("chunkContent", () => {
  it("returns no chunks for empty input", () => {
    expect(chunkContent(null, null)).toEqual([]);
    expect(chunkContent("", "")).toEqual([]);
  });

  it("returns a single chunk when input is shorter than the chunk size", () => {
    const chunks = chunkContent("Short title", "Short body", { source: "test" });

    expect(chunks).toEqual([
      {
        index: 0,
        content: "Short title\n\nShort body",
        tokenCount: Math.ceil("Short title\n\nShort body".length / 4),
        metadata: { source: "test" },
      },
    ]);
  });

  it("honors the maximum chunk size and keeps trailing remainders", () => {
    const content = "a".repeat(1700);

    const chunks = chunkContent(null, content);

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.content.length)).toEqual([800, 800, 300]);
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2]);
  });

  it("honors overlap between chunks", () => {
    const content = Array.from({ length: 1000 }, (_, index) => String(index % 10)).join("");

    const chunks = chunkContent(null, content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content.slice(-100)).toBe(chunks[1].content.slice(0, 100));
  });

  it("splits on structural whitespace before exceeding the chunk size", () => {
    const firstSection = "alpha ".repeat(100).trim();
    const secondSection = "bravo ".repeat(100).trim();

    const chunks = chunkContent(null, `${firstSection}\n\n${secondSection}`);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe(firstSection);
    expect(chunks[1].content).toBe(secondSection);
  });

  it("includes title and metadata on every emitted chunk", () => {
    const chunks = chunkContent("Knowledge Base", "body ".repeat(200), {
      sourceType: "item",
    });

    expect(chunks[0].content).toContain("Knowledge Base");
    expect(chunks.every((chunk) => chunk.metadata.sourceType === "item")).toBe(true);
  });
});

describe("contentHash", () => {
  it("is deterministic for the same title and content", () => {
    expect(contentHash("Title", "Body")).toBe(contentHash("Title", "Body"));
  });

  it("changes when title or content changes", () => {
    expect(contentHash("Title", "Body")).not.toBe(contentHash("Other", "Body"));
    expect(contentHash("Title", "Body")).not.toBe(contentHash("Title", "Other"));
  });

  it("treats null title and content as empty strings", () => {
    expect(contentHash(null, null)).toBe(contentHash("", ""));
  });
});
