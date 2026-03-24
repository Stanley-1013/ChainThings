import { describe, it, expect, vi, beforeAll } from "vitest";

// Unmock the module so we test the real implementation
vi.unmock("@/lib/memory/extractor");

import { shouldExtractMemory } from "@/lib/memory/extractor";

describe("shouldExtractMemory", () => {
  it("should return false for n8n tool mode", () => {
    expect(shouldExtractMemory("Create a workflow for email", "n8n")).toBe(false);
  });

  it("should return false for short messages", () => {
    expect(shouldExtractMemory("ok", null)).toBe(false);
    expect(shouldExtractMemory("hi there!", null)).toBe(false);
  });

  it("should return false for greetings", () => {
    expect(shouldExtractMemory("hello how are you doing today", null)).toBe(false);
    expect(shouldExtractMemory("thanks for the help with that", null)).toBe(false);
    expect(shouldExtractMemory("Hi can you help me with something", null)).toBe(false);
  });

  it("should return true for substantive messages", () => {
    expect(shouldExtractMemory("明天下午三點要跟客戶開會討論新功能的需求規格和時程安排", null)).toBe(true);
    expect(shouldExtractMemory("I prefer dark mode and concise responses in my settings", null)).toBe(true);
    expect(shouldExtractMemory("The project deadline for Phase 2 is March 30th", null)).toBe(true);
  });
});
