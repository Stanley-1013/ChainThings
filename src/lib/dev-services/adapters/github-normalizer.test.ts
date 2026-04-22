import { describe, it, expect } from "vitest";
import { normalizeGitHubEvent } from "./github-normalizer";

// Minimal PR payload factory
function prPayload(action: string, merged = false) {
  return {
    action,
    number: 7,
    pull_request: {
      id: 1001,
      title: "My PR",
      body: "Fixes something",
      html_url: "https://github.com/org/repo/pull/7",
      state: merged ? "closed" : "open",
      merged,
      head: { ref: "feature/my-branch", sha: "abc123" },
      base: { ref: "main", repo: { full_name: "org/repo" } },
      user: { id: 42, login: "dev" },
    },
  };
}

// Minimal issue payload factory
function issuePayload(action: string) {
  return {
    action,
    issue: {
      number: 3,
      title: "Bug report",
      body: "Something broke",
      html_url: "https://github.com/org/repo/issues/3",
      state: "open",
      labels: [{ name: "bug" }],
      user: { id: 99, login: "reporter" },
    },
    repository: { full_name: "org/repo" },
  };
}

describe("normalizeGitHubEvent — pull_request", () => {
  it("maps pull_request.opened → mr.opened with merge_request resource", () => {
    const result = normalizeGitHubEvent("pull_request", prPayload("opened"));
    expect(result).not.toBeNull();
    expect(result?.eventName).toBe("mr.opened");
    expect(result?.resource.type).toBe("merge_request");
    expect(result?.resource.sourceBranch).toBe("feature/my-branch");
  });

  it("maps pull_request.synchronize → mr.updated", () => {
    const result = normalizeGitHubEvent("pull_request", prPayload("synchronize"));
    expect(result?.eventName).toBe("mr.updated");
  });

  it("maps pull_request.closed with merged=true → mr.merged", () => {
    const result = normalizeGitHubEvent("pull_request", prPayload("closed", true));
    expect(result?.eventName).toBe("mr.merged");
  });
});

describe("normalizeGitHubEvent — issues", () => {
  it("maps issues.opened → issue.opened with resource.type=issue", () => {
    const result = normalizeGitHubEvent("issues", issuePayload("opened"));
    expect(result).not.toBeNull();
    expect(result?.eventName).toBe("issue.opened");
    expect(result?.resource.type).toBe("issue");
  });
});

describe("normalizeGitHubEvent — unknown events", () => {
  it("returns null for an unrecognised raw event type", () => {
    const result = normalizeGitHubEvent("deployment", { action: "created" });
    expect(result).toBeNull();
  });
});
