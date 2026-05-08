import { describe, it, expect, vi } from "vitest";

// Mock supabaseAdmin (linker.ts imports it for DB calls; we only test extractTicketRefs here)
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Mock the factory used by transitionTicket
vi.mock("../factory", () => ({
  createDevServiceClient: vi.fn(),
}));

import { extractTicketRefs } from "./linker";

describe("extractTicketRefs", () => {
  it("extracts multiple ticket refs from text matching known projects", () => {
    const refs = extractTicketRefs("Fix PROJ-123 and BACK-456", ["PROJ", "BACK"]);
    expect(refs).toEqual(expect.arrayContaining(["PROJ-123", "BACK-456"]));
    expect(refs).toHaveLength(2);
  });

  it("deduplicates repeated references", () => {
    const refs = extractTicketRefs("PROJ-1 and PROJ-1 again", ["PROJ"]);
    expect(refs).toEqual(["PROJ-1"]);
  });

  it("returns empty array when no project keys are provided", () => {
    expect(extractTicketRefs("PROJ-123 is mentioned", [])).toEqual([]);
  });

  it("returns empty array for empty text", () => {
    expect(extractTicketRefs("", ["PROJ"])).toEqual([]);
  });

  it("is case-insensitive and normalises to uppercase", () => {
    const refs = extractTicketRefs("fixes proj-123", ["PROJ"]);
    expect(refs).toEqual(["PROJ-123"]);
  });

  // ── B7: regex injection guard ─────────────────────────────────────────────

  it("does not throw when a project key contains a regex metacharacter (B7)", () => {
    // A key like "PROJ.X" without escaping would match "PROJAX-1" (dot = any char).
    // With escaping it should only match literal "PROJ.X-" patterns.
    expect(() =>
      extractTicketRefs("PROJAX-1 is here", ["PROJ.X"]),
    ).not.toThrow();
  });

  it("does not match spurious tickets when project key has metacharacters (B7)", () => {
    // "PROJ+": without escaping the + makes the P required-repeated, breaking or
    // widening the match. With escaping, no match should be returned for "PROJ-1".
    const refs = extractTicketRefs("PROJ-1 is in PROJ.X-2", ["PROJ.X"]);
    // Should only match literal "PROJ.X-2", not "PROJ-1"
    expect(refs).not.toContain("PROJ-1");
  });
});
