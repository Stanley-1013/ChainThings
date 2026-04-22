import type { NormalizedEvent, EventNormalizerFn } from "../types";

interface JiraWebhookPayload {
  webhookEvent: string;
  issue_event_type_name?: string;
  user: { accountId: string; displayName: string };
  issue: {
    id: string;
    key: string;
    self: string;
    fields: {
      summary: string;
      description?: unknown;
      status: { name: string };
      project: { key: string };
      issuetype: { name: string };
      labels: string[];
    };
  };
  changelog?: {
    items: Array<{
      field: string;
      fromString: string | null;
      toString: string | null;
    }>;
  };
}

function getJiraBrowseUrl(selfUrl: string, issueKey: string): string {
  try {
    const url = new URL(selfUrl);
    return `${url.origin}/browse/${issueKey}`;
  } catch {
    return "";
  }
}

export const normalizeJiraEvent: EventNormalizerFn = (
  rawEventType: string,
  payload: unknown,
): NormalizedEvent | null => {
  const p = payload as JiraWebhookPayload;
  if (!p.issue) return null;

  const webhookEvent = p.webhookEvent ?? rawEventType;
  let eventName: string;

  if (
    webhookEvent === "jira:issue_created" ||
    webhookEvent === "issue_created"
  ) {
    eventName = "issue.opened";
  } else if (
    webhookEvent === "jira:issue_updated" ||
    webhookEvent === "issue_updated"
  ) {
    // Check if status changed
    const statusChange = p.changelog?.items?.find(
      (i) => i.field === "status",
    );
    if (statusChange?.toString?.toLowerCase().includes("done")) {
      eventName = "issue.closed";
    } else {
      eventName = "issue.updated";
    }
  } else if (
    webhookEvent === "jira:issue_deleted" ||
    webhookEvent === "issue_deleted"
  ) {
    eventName = "issue.deleted";
  } else {
    return null;
  }

  const browseUrl = getJiraBrowseUrl(p.issue.self, p.issue.key);

  return {
    eventName,
    actor: {
      id: p.user.accountId,
      login: p.user.displayName,
    },
    resource: {
      type: "issue",
      ref: p.issue.key,
      repoRef: p.issue.fields.project.key,
      url: browseUrl,
      title: p.issue.fields.summary,
      state: p.issue.fields.status.name,
    },
    dedupeKey: `jira:issue:${p.issue.key}:${webhookEvent}:${p.issue.id}`,
    normalizedPayload: {
      issueType: p.issue.fields.issuetype.name,
      labels: p.issue.fields.labels,
      statusChange: p.changelog?.items?.find((i) => i.field === "status"),
    },
  };
};
