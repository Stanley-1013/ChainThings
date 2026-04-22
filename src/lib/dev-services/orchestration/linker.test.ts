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
});
