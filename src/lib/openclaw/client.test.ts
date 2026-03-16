import { describe, it, expect, vi } from "vitest";

vi.unmock("@/lib/openclaw/client");
vi.unmock("@/lib/ai-gateway");

import { chatCompletion } from "./client";

describe("openclaw/client re-export", () => {
  it("exports chatCompletion from ai-gateway", () => {
    expect(typeof chatCompletion).toBe("function");
  });
});
