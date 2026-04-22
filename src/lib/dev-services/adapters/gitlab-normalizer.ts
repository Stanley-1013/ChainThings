import type { NormalizedEvent, EventNormalizerFn } from "../types";

interface GLMRPayload {
  user: { id: number; username: string };
  project: { path_with_namespace: string; web_url: string };
  object_attributes: {
    iid: number;
    title: string;
    description: string | null;
    url: string;
    state: string;
    action: string;
    source_branch: string;
    target_branch: string;
    last_commit: { id: string };
  };
}

interface GLIssuePayload {
  user: { id: number; username: string };
  project: { path_with_namespace: string };
  object_attributes: {
    iid: number;
    title: string;
    description: string | null;
    url: string;
    state: string;
    action: string;
    labels?: Array<{ title: string }>;
  };
}

export const normalizeGitLabEvent: EventNormalizerFn = (
  rawEventType: string,
  payload: unknown,
): NormalizedEvent | null => {
  if (rawEventType === "Merge Request Hook") {
    const mr = payload as GLMRPayload;
    const action = mr.object_attributes.action;
    const repo = mr.project.path_with_namespace;
    const iid = mr.object_attributes.iid;
    const sha = mr.object_attributes.last_commit?.id ?? "";

    let eventName: string;
    if (action === "open" || action === "reopen") eventName = "mr.opened";
    else if (action === "update") eventName = "mr.updated";
    else if (action === "merge") eventName = "mr.merged";
    else if (action === "close") eventName = "mr.closed";
    else return null;

    const isMerged = action === "merge" || mr.object_attributes.state === "merged";

    return {
      eventName,
      actor: {
        id: String(mr.user.id),
        login: mr.user.username,
      },
      resource: {
        type: "merge_request",
        ref: String(iid),
        repoRef: repo,
        url: mr.object_attributes.url,
        title: mr.object_attributes.title,
        body: mr.object_attributes.description ?? undefined,
        sourceBranch: mr.object_attributes.source_branch,
        state: isMerged ? "merged" : mr.object_attributes.state,
      },
      dedupeKey: `gitlab:mr:${repo}:${iid}:${action}:${sha}`,
      normalizedPayload: {
        headSha: sha,
        baseBranch: mr.object_attributes.target_branch,
      },
    };
  }

  if (rawEventType === "Issue Hook") {
    const issue = payload as GLIssuePayload;
    const action = issue.object_attributes.action;
    const repo = issue.project.path_with_namespace;
    const iid = issue.object_attributes.iid;

    let eventName: string;
    if (action === "open") eventName = "issue.opened";
    else if (action === "close") eventName = "issue.closed";
    else if (action === "reopen") eventName = "issue.reopened";
    else return null;

    return {
      eventName,
      actor: {
        id: String(issue.user.id),
        login: issue.user.username,
      },
      resource: {
        type: "issue",
        ref: String(iid),
        repoRef: repo,
        url: issue.object_attributes.url,
        title: issue.object_attributes.title,
        body: issue.object_attributes.description ?? undefined,
        state: issue.object_attributes.state,
      },
      dedupeKey: `gitlab:issue:${repo}:${iid}:${action}`,
      normalizedPayload: {
        labels: (issue.object_attributes.labels ?? []).map((l) => l.title),
      },
    };
  }

  return null;
};
