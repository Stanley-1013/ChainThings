import type {
  CreateIssueOptions,
  DevServiceClient,
  Issue,
  IssueListParams,
  ServiceCapability,
  ServiceUser,
  Transition,
  WorkItemClient,
} from "../types";
import {
  AuthExpiredError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  RetryableNetworkError,
} from "../types";

const DEFAULT_TIMEOUT = 15_000;

export class JiraClient implements DevServiceClient, WorkItemClient {
  readonly service = "jira";
  readonly capabilities: ServiceCapability[] = ["issues", "summary", "transitions"];
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(
    domain: string,
    _email: string,
    _apiToken: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT,
  ) {
    this.baseUrl = `https://${domain}.atlassian.net`;
    // Basic auth header: base64(email:rawApiToken).
    // Expects the raw API token — NOT a pre-encoded value.
    this.authHeader = `Basic ${Buffer.from(`${_email}:${_apiToken}`).toString("base64")}`;
  }

  asCodeHost(): undefined {
    return undefined;
  }
  asWorkItemTracker(): WorkItemClient {
    return this;
  }

  async getAuthenticatedUser(): Promise<ServiceUser> {
    const u = await this.json<{ accountId: string; displayName: string; avatarUrls?: Record<string, string> }>(
      "/rest/api/3/myself",
    );
    return { id: u.accountId, login: u.displayName, avatarUrl: u.avatarUrls?.["48x48"] };
  }

  // ── Issues ──────────────────────────────────────────────

  async listIssues(projectRef: string, params: IssueListParams = {}): Promise<Issue[]> {
    const clauses = [`project = "${esc(projectRef)}"`, "sprint in openSprints()"];
    if (params.state) clauses.push(`status = "${esc(params.state)}"`);
    if (params.labels?.length) clauses.push(`labels in (${params.labels.map((l) => `"${esc(l)}"`).join(",")})`);
    const res = await this.json<{ issues: JiraIssue[] }>("/rest/api/3/search", {
      method: "POST",
      body: JSON.stringify({
        jql: `${clauses.join(" AND ")} ORDER BY updated DESC`,
        maxResults: params.limit ?? 50,
        fields: ["summary", "status", "labels"],
      }),
    });
    return res.issues.map((i) => this.map(i));
  }

  async createIssue(projectRef: string, title: string, body: string, opts: CreateIssueOptions = {}): Promise<Issue> {
    const created = await this.json<JiraIssue>("/rest/api/3/issue", {
      method: "POST",
      body: JSON.stringify({
        fields: {
          project: { key: projectRef },
          summary: title,
          description: toAdf(body),
          issuetype: { name: opts.issueType ?? "Task" },
          labels: opts.labels ?? [],
          priority: opts.priority ? { name: opts.priority } : undefined,
          assignee: opts.assignee ? { accountId: opts.assignee } : undefined,
        },
      }),
    });
    if (opts.sprintId) {
      await this.json(`/rest/agile/1.0/sprint/${encodeURIComponent(opts.sprintId)}/issue`, {
        method: "POST",
        body: JSON.stringify({ issues: [created.key] }),
      });
    }
    return this.getIssue(projectRef, created.key);
  }

  async getIssue(_projectRef: string, issueRef: string): Promise<Issue> {
    const i = await this.json<JiraIssue>(`/rest/api/3/issue/${encodeURIComponent(issueRef)}?fields=summary,status,labels`);
    return this.map(i);
  }

  async updateIssueStatus(_projectRef: string, issueRef: string, status: string): Promise<Issue> {
    const transitions = await this.getAvailableTransitions("", issueRef);
    const t = transitions.find((tr) => tr.id === status || tr.name.toLowerCase() === status.trim().toLowerCase());
    if (!t) throw new NotFoundError(this.service, `transition "${status}" for ${issueRef}`);
    await this.json(`/rest/api/3/issue/${encodeURIComponent(issueRef)}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: t.id } }),
    });
    return this.getIssue("", issueRef);
  }

  async getAvailableTransitions(_projectRef: string, issueRef: string): Promise<Transition[]> {
    const res = await this.json<{ transitions: Array<{ id: string; name: string }> }>(
      `/rest/api/3/issue/${encodeURIComponent(issueRef)}/transitions`,
    );
    return res.transitions.map((t) => ({ id: t.id, name: t.name }));
  }

  // ── Sprint (Agile) ─────────────────────────────────────

  async getActiveSprint(boardId: string) {
    const res = await this.json<{ values: Array<{ id: number; name: string; state: string }> }>(
      `/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint?state=active`,
    );
    const s = res.values[0];
    return s ? { id: String(s.id), name: s.name, state: s.state } : null;
  }

  async getSprintIssues(sprintId: string): Promise<Issue[]> {
    const res = await this.json<{ issues: JiraIssue[] }>(
      `/rest/agile/1.0/sprint/${encodeURIComponent(sprintId)}/issue?fields=summary,status,labels`,
    );
    return res.issues.map((i) => this.map(i));
  }

  // ── Internals ───────────────────────────────────────────

  private map(i: JiraIssue): Issue {
    return {
      ref: i.key,
      title: i.fields?.summary ?? i.key,
      url: `${this.baseUrl}/browse/${i.key}`,
      state: i.fields?.status?.name ?? "Unknown",
      labels: i.fields?.labels ?? [],
    };
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.req(path, init);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async req(path: string, init: RequestInit): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: ac.signal,
        headers: {
          Accept: "application/json",
          Authorization: this.authHeader,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
      if (res.status === 429) throw new RateLimitError(this.service, Number(res.headers.get("Retry-After") ?? "60"));
      if (res.status === 401) throw new AuthExpiredError(this.service);
      if (res.status === 403) throw new PermissionDeniedError(this.service);
      if (res.status === 404) throw new NotFoundError(this.service, path);
      if (res.status >= 500) throw new RetryableNetworkError(this.service, `${res.status}`);
      if (!res.ok) throw new Error(`Jira API ${res.status}: ${res.statusText}`);
      return res;
    } catch (e) {
      if (e instanceof AuthExpiredError || e instanceof NotFoundError || e instanceof PermissionDeniedError || e instanceof RateLimitError || e instanceof RetryableNetworkError) throw e;
      if (e instanceof DOMException && e.name === "AbortError") throw new RetryableNetworkError(this.service, "timeout");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────

interface JiraIssue {
  id?: string;
  key: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
    labels?: string[];
  };
}

function toAdf(text: string): Record<string, unknown> {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => ({ type: "paragraph", content: [{ type: "text", text: b }] }));
  return {
    version: 1,
    type: "doc",
    content: paragraphs.length ? paragraphs : [{ type: "paragraph", content: [] }],
  };
}

function esc(v: string) {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
