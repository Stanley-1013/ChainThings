import { describe, it, expect, vi } from "vitest";

// Undo global mock from setup.ts so we test the real module
vi.unmock("@/lib/n8n/validation");

import { validateWorkflowNodes } from "./validation";

describe("validateWorkflowNodes", () => {
  it("accepts all allowed node types", () => {
    const nodes = [
      { type: "n8n-nodes-base.webhook" },
      { type: "n8n-nodes-base.set" },
      { type: "n8n-nodes-base.if" },
      { type: "n8n-nodes-base.switch" },
      { type: "n8n-nodes-base.merge" },
      { type: "n8n-nodes-base.noOp" },
      { type: "n8n-nodes-base.filter" },
      { type: "n8n-nodes-base.sort" },
      { type: "n8n-nodes-base.limit" },
      { type: "n8n-nodes-base.start" },
    ];
    const result = validateWorkflowNodes(nodes);
    expect(result).toEqual({ valid: true, disallowed: [] });
  });

  it("rejects disallowed node types", () => {
    const nodes = [
      { type: "n8n-nodes-base.webhook" },
      { type: "n8n-nodes-base.code" },
      { type: "n8n-nodes-base.httpRequest" },
    ];
    const result = validateWorkflowNodes(nodes);
    expect(result.valid).toBe(false);
    expect(result.disallowed).toEqual([
      "n8n-nodes-base.code",
      "n8n-nodes-base.httpRequest",
    ]);
  });

  it("returns valid for empty nodes array", () => {
    expect(validateWorkflowNodes([])).toEqual({ valid: true, disallowed: [] });
  });

  it("skips nodes without a type property", () => {
    const nodes = [{ name: "no-type" }, null, "string-node"];
    const result = validateWorkflowNodes(nodes as unknown[]);
    expect(result).toEqual({ valid: true, disallowed: [] });
  });

  it("rejects dangerous execution nodes", () => {
    const dangerousTypes = [
      "n8n-nodes-base.code",
      "n8n-nodes-base.httpRequest",
      "n8n-nodes-base.executeCommand",
      "n8n-nodes-base.function",
      "n8n-nodes-base.functionItem",
    ];
    const nodes = dangerousTypes.map((type) => ({ type }));
    const result = validateWorkflowNodes(nodes);
    expect(result.valid).toBe(false);
    expect(result.disallowed).toEqual(dangerousTypes);
  });

  it("handles mixed valid and invalid nodes", () => {
    const nodes = [
      { type: "n8n-nodes-base.webhook" },
      { type: "n8n-nodes-base.code" },
      { type: "n8n-nodes-base.set" },
    ];
    const result = validateWorkflowNodes(nodes);
    expect(result.valid).toBe(false);
    expect(result.disallowed).toEqual(["n8n-nodes-base.code"]);
  });
});
