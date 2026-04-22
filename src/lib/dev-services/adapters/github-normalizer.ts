import type { NormalizedEvent, EventNormalizerFn } from "../types";

interface GitHubPRPayload {
  action: string;
  number: number;
  pull_request: {
    id: number;
    title: string;
    body: string | null;
    html_url: string;
    state: string;
    merged: boolean;
    head: { ref: string; sha: string };
    base: { ref: string; repo: { full_name: string } };
    user: { id: number; login: string };
  };
}

interface GitHubIssuePayload {
  action: string;
  issue: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: string;
    labels: Array<{ name: string }>;
    user: { id: number; login: string };
  };
  repository: { full_name: string };
}

export const normalizeGitHubEvent: EventNormalizerFn = (
  rawEventType: string,
  payload: unknown,
): NormalizedEvent | null => {
  const p = payload as Record<string, unknown>;
  const action = p.action as string | undefined;
  const fullEvent = action ? `${rawEventType}.${action}` : rawEventType;

  if (rawEventType === "pull_request") {
    const pr = p as unknown as GitHubPRPayload;
    const merged = pr.pull_request.merged;
    let eventName: string;
    if (action === "opened" || action === "reopened") eventName = "mr.opened";
    else if (action === "synchronize") eventName = "mr.updated";
    else if (action === "closed" && merged) eventName = "mr.merged";
    else if (action === "closed") eventName = "mr.closed";
    else return null;

    return {
      eventName,
      actor: {
        id: String(pr.pull_request.user.id),
        login: pr.pull_request.user.login,
      },
      resource: {
        type: "merge_request",
        ref: String(pr.number),
        repoRef: pr.pull_request.base.repo.full_name,
        url: pr.pull_request.html_url,
        title: pr.pull_request.title,
        body: pr.pull_request.body ?? undefined,
        sourceBranch: pr.pull_request.head.ref,
        state: merged ? "merged" : pr.pull_request.state,
      },
      dedupeKey: `github:pr:${pr.pull_request.base.repo.full_name}:${pr.number}:${action}:${pr.pull_request.head.sha}`,
      normalizedPayload: {
        headSha: pr.pull_request.head.sha,
        baseBranch: pr.pull_request.base.ref,
      },
    };
  }

  if (rawEventType === "issues") {
    const issue = p as unknown as GitHubIssuePayload;
    let eventName: string;
    if (action === "opened") eventName = "issue.opened";
    else if (action === "closed") eventName = "issue.closed";
    else if (action === "reopened") eventName = "issue.reopened";
    else return null;

    return {
      eventName,
      actor: {
        id: String(issue.issue.user.id),
        login: issue.issue.user.login,
      },
      resource: {
        type: "issue",
        ref: String(issue.issue.number),
        repoRef: issue.repository.full_name,
        url: issue.issue.html_url,
        title: issue.issue.title,
        body: issue.issue.body ?? undefined,
        state: issue.issue.state,
      },
      dedupeKey: `github:issue:${issue.repository.full_name}:${issue.issue.number}:${action}`,
      normalizedPayload: {
        labels: issue.issue.labels.map((l) => l.name),
      },
    };
  }

  return null;
};
