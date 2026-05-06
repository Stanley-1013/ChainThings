import { describe, it, expect, vi } from "vitest";

// Mock heavy runtime dependencies so tests stay fast and offline.
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("./orchestration/linker", () => ({
  processMREvent: vi.fn(),
}));

vi.mock("./orchestration/workflow-engine", () => ({
  executeWorkflow: vi.fn(),
}));

vi.mock("./approval", () => ({
  hashParams: vi.fn(() => "hash-abc"),
}));

vi.mock("./engines/code-review", () => ({
  generateReviewDraft: vi.fn(),
  submitReview: vi.fn(),
}));

vi.mock("./engines/test-generation", () => ({
  generateTestsFromDiff: vi.fn(),
  generateTestsFromCode: vi.fn(),
}));

import { getAction, getActionNames, validateActionInput } from "./action-registry";

describe("action-registry", () => {
  describe("sync_pr_to_jira registration", () => {
    it("is registered in the action registry", () => {
      expect(getActionNames()).toContain("sync_pr_to_jira");
    });

    it("has the correct requiredCapability", () => {
      const action = getAction("sync_pr_to_jira");
      expect(action).toBeDefined();
      expect(action!.requiredCapability).toBe("branches");
    });

    it("does not require approval", () => {
      const action = getAction("sync_pr_to_jira");
      expect(action!.requiresApproval).toBe(false);
    });

    it("accepts valid input with mr_opened event", () => {
      const result = validateActionInput("sync_pr_to_jira", {
        repoRef: "owner/repo",
        prRef: "42",
        event: "mr_opened",
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid input with mr_merged event", () => {
      const result = validateActionInput("sync_pr_to_jira", {
        repoRef: "owner/repo",
        prRef: "42",
        event: "mr_merged",
      });
      expect(result.success).toBe(true);
    });

    it("rejects an invalid event value", () => {
      const result = validateActionInput("sync_pr_to_jira", {
        repoRef: "owner/repo",
        prRef: "42",
        event: "pr_created",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        // Zod formats the error as a JSON string; the value "pr_created" should not be valid
        expect(result.error).toMatch(/mr_opened|mr_merged|invalid/i);
      }
    });

    it("rejects missing event field", () => {
      const result = validateActionInput("sync_pr_to_jira", {
        repoRef: "owner/repo",
        prRef: "42",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing repoRef", () => {
      const result = validateActionInput("sync_pr_to_jira", {
        prRef: "42",
        event: "mr_opened",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("known actions registered", () => {
    const expectedActions = [
      "list_repos",
      "list_issues",
      "create_issue",
      "get_mr",
      "review_mr",
      "generate_tests",
      "submit_review",
      "execute_workflow",
      "sync_pr_to_jira",
    ];

    it("has all expected actions registered", () => {
      const names = getActionNames();
      for (const name of expectedActions) {
        expect(names).toContain(name);
      }
    });
  });
});
