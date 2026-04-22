import type {
  Branch,
  ChangedFile,
  CodeHostClient,
  CreateIssueOptions,
  DevServiceClient,
  Issue,
  IssueListParams,
  MergeRequest,
  Repo,
  ReviewComment,
  ReviewEvent,
  ServiceCapability,
  ServiceUser,
  WorkItemClient,
} from "../types";
import {
  AuthExpiredError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  RetryableNetworkError,
} from "../types";
import { truncateDiff } from "./github";

const DEFAULT_BASE_URL = "https://gitlab.com";
const DEFAULT_TIMEOUT = 15_000;
const MAX_DIFF_TOKENS = 12_000;

export class GitLabClient
  implements DevServiceClient, CodeHostClient, WorkItemClient
{
  readonly service = "gitlab";
  readonly capabilities: ServiceCapability[] = [
    "code_review",
    "issues",
    "test_gen",
    "summary",
    "branches",
  ];
  readonly getAvailableTransitions = undefined;

  private readonly apiBase: string;

  constructor(
    private readonly accessToken: string,
    baseUrl: string = DEFAULT_BASE_URL,
    private readonly timeoutMs = DEFAULT_TIMEOUT,
  ) {
    this.apiBase = `${baseUrl.replace(/\/$/, "")}/api/v4`;
  }

  asCodeHost(): CodeHostClient {
    return this;
  }
  asWorkItemTracker(): WorkItemClient {
    return this;
  }

  // ── User ────────────────────────────────────────────────

  async getAuthenticatedUser(): Promise<ServiceUser> {
    const u = await this.json<{ id: number; username: string; avatar_url?: string }>("/user");
    return { id: String(u.id), login: u.username, avatarUrl: u.avatar_url };
  }

  // ── Repos ───────────────────────────────────────────────

  async listRepos(): Promise<Repo[]> {
    const projects = await this.json<Array<{
      path_with_namespace: string;
      name: string;
      web_url: string;
      default_branch: string;
    }>>("/projects?membership=true&per_page=100&order_by=last_activity_at");
    return projects.map((p) => ({
      ref: p.path_with_namespace,
      name: p.name,
      url: p.web_url,
      defaultBranch: p.default_branch,
    }));
  }

  async getFileContent(repoRef: string, path: string, ref?: string): Promise<string> {
    const encodedRepo = encodeRepo(repoRef);
    const encodedPath = encodeURIComponent(path);
    const refParam = ref ? encodeURIComponent(ref) : "HEAD";
    return this.text(`/projects/${encodedRepo}/repository/files/${encodedPath}/raw?ref=${refParam}`);
  }

  // ── Branches ────────────────────────────────────────────

  async createBranch(repoRef: string, branchName: string, fromRef?: string): Promise<Branch> {
    const encodedRepo = encodeRepo(repoRef);
    const ref = fromRef ?? await this.getDefaultBranch(repoRef);
    const q = new URLSearchParams({ branch: branchName, ref });
    const result = await this.json<{ name: string; web_url: string }>(
      `/projects/${encodedRepo}/repository/branches?${q}`,
      { method: "POST" },
    );
    return {
      ref: result.name,
      name: result.name,
      url: result.web_url,
    };
  }

  // ── Merge Requests ──────────────────────────────────────

  async getMergeRequest(repoRef: string, mrRef: string): Promise<MergeRequest> {
    const encodedRepo = encodeRepo(repoRef);
    const mr = await this.json<MRResponse>(`/projects/${encodedRepo}/merge_requests/${mrRef}`);
    return mapMR(mr);
  }

  async getMergeRequestDiff(repoRef: string, mrRef: string): Promise<string> {
    const encodedRepo = encodeRepo(repoRef);
    const data = await this.json<{ changes: ChangeEntry[] }>(
      `/projects/${encodedRepo}/merge_requests/${mrRef}/changes`,
    );
    const raw = buildUnifiedDiff(data.changes);
    return truncateDiff(raw, MAX_DIFF_TOKENS);
  }

  async getMergeRequestFiles(repoRef: string, mrRef: string): Promise<ChangedFile[]> {
    const encodedRepo = encodeRepo(repoRef);
    const data = await this.json<{ changes: ChangeEntry[] }>(
      `/projects/${encodedRepo}/merge_requests/${mrRef}/changes`,
    );
    return data.changes.map((c) => ({
      path: c.new_path,
      status: c.new_file
        ? "added"
        : c.deleted_file
          ? "deleted"
          : c.renamed_file
            ? "renamed"
            : "modified",
    }));
  }

  async createMergeRequest(
    repoRef: string,
    title: string,
    body: string,
    sourceBranch: string,
    targetBranch?: string,
  ): Promise<MergeRequest> {
    const encodedRepo = encodeRepo(repoRef);
    const target = targetBranch ?? await this.getDefaultBranch(repoRef);
    const mr = await this.json<MRResponse>(`/projects/${encodedRepo}/merge_requests`, {
      method: "POST",
      body: JSON.stringify({
        source_branch: sourceBranch,
        target_branch: target,
        title,
        description: body,
      }),
    });
    return mapMR(mr);
  }

  async submitReview(
    repoRef: string,
    mrRef: string,
    body: string,
    comments: ReviewComment[],
    event: ReviewEvent,
  ): Promise<void> {
    const encodedRepo = encodeRepo(repoRef);

    // Build summary note body — include inline comments as a bulleted list
    // since GitLab line-comment positions require base/start/head SHAs from the diff version,
    // which adds a round-trip; we fold them into the summary for reliability.
    let summaryBody = body;
    if (comments.length > 0) {
      const commentLines = comments.map(
        (c) => `- **[${c.severity.toUpperCase()}]** \`${c.path}:${c.line}\` — ${c.body}${c.suggestion ? `\n  \`\`\`suggestion\n  ${c.suggestion}\n  \`\`\`` : ""}`,
      );
      summaryBody += "\n\n---\n\n**Inline Comments:**\n\n" + commentLines.join("\n");
    }
    if (event === "request_changes") {
      summaryBody += "\n\n⚠️ Changes requested";
    }

    await this.json(`/projects/${encodedRepo}/merge_requests/${mrRef}/notes`, {
      method: "POST",
      body: JSON.stringify({ body: summaryBody }),
    });

    if (event === "approve") {
      await this.json(`/projects/${encodedRepo}/merge_requests/${mrRef}/approve`, {
        method: "POST",
      });
    }
  }

  // ── Issues ──────────────────────────────────────────────

  async listIssues(projectRef: string, params: IssueListParams = {}): Promise<Issue[]> {
    const encodedRepo = encodeRepo(projectRef);
    const q = new URLSearchParams({
      state: params.state === "closed" ? "closed" : "opened",
      per_page: String(params.limit ?? 50),
    });
    if (params.labels?.length) q.set("labels", params.labels.join(","));
    const issues = await this.json<GLIssueResponse[]>(
      `/projects/${encodedRepo}/issues?${q}`,
    );
    return issues.map(mapGLIssue);
  }

  async createIssue(
    projectRef: string,
    title: string,
    body: string,
    opts: CreateIssueOptions = {},
  ): Promise<Issue> {
    const encodedRepo = encodeRepo(projectRef);
    const labelsArr: string[] = [...(opts.labels ?? [])];
    if (opts.priority) labelsArr.push(`priority:${opts.priority}`);
    if (opts.issueType) labelsArr.push(`type:${opts.issueType}`);
    const issue = await this.json<GLIssueResponse>(
      `/projects/${encodedRepo}/issues`,
      {
        method: "POST",
        body: JSON.stringify({
          title,
          description: body,
          labels: labelsArr.length ? labelsArr.join(",") : undefined,
        }),
      },
    );
    return mapGLIssue(issue);
  }

  async getIssue(projectRef: string, issueRef: string): Promise<Issue> {
    const encodedRepo = encodeRepo(projectRef);
    const issue = await this.json<GLIssueResponse>(
      `/projects/${encodedRepo}/issues/${issueRef}`,
    );
    return mapGLIssue(issue);
  }

  async updateIssueStatus(
    projectRef: string,
    issueRef: string,
    status: string,
  ): Promise<Issue> {
    const encodedRepo = encodeRepo(projectRef);
    const s = status.trim().toLowerCase();
    const stateEvent = s === "closed" || s === "done" || s === "resolved" ? "close" : "reopen";
    const issue = await this.json<GLIssueResponse>(
      `/projects/${encodedRepo}/issues/${issueRef}`,
      {
        method: "PUT",
        body: JSON.stringify({ state_event: stateEvent }),
      },
    );
    return mapGLIssue(issue);
  }

  // ── Internals ───────────────────────────────────────────

  private async getDefaultBranch(repoRef: string): Promise<string> {
    const encodedRepo = encodeRepo(repoRef);
    const p = await this.json<{ default_branch: string }>(`/projects/${encodedRepo}`);
    return p.default_branch;
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetch(path, init);
    return (await res.json()) as T;
  }

  private async text(path: string, init: RequestInit = {}): Promise<string> {
    return (await this.fetch(path, init)).text();
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.apiBase}${path}`, {
        ...init,
        signal: ac.signal,
        headers: {
          "Content-Type": "application/json",
          "PRIVATE-TOKEN": this.accessToken,
          ...init.headers,
        },
      });
      if (res.status === 401) throw new AuthExpiredError(this.service);
      if (res.status === 403) throw new PermissionDeniedError(this.service);
      if (res.status === 404) throw new NotFoundError(this.service, path);
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "60");
        throw new RateLimitError(this.service, retryAfter);
      }
      if (res.status >= 500) throw new RetryableNetworkError(this.service, `${res.status}`);
      if (!res.ok) throw new Error(`GitLab API ${res.status}: ${res.statusText}`);
      return res;
    } catch (e) {
      if (
        e instanceof AuthExpiredError ||
        e instanceof PermissionDeniedError ||
        e instanceof NotFoundError ||
        e instanceof RateLimitError ||
        e instanceof RetryableNetworkError
      ) throw e;
      if (e instanceof DOMException && e.name === "AbortError")
        throw new RetryableNetworkError(this.service, "timeout");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────

function encodeRepo(ref: string): string {
  return encodeURIComponent(ref);
}

function buildUnifiedDiff(changes: ChangeEntry[]): string {
  return changes
    .map((c) => {
      const header = `diff --git a/${c.old_path} b/${c.new_path}\n`;
      return header + (c.diff ?? "");
    })
    .join("");
}

function mapMR(mr: MRResponse): MergeRequest {
  return {
    ref: String(mr.iid),
    title: mr.title,
    url: mr.web_url,
    state: mr.merged_at ? "merged" : mr.state,
    author: mr.author?.username ?? "unknown",
    sourceBranch: mr.source_branch,
    targetBranch: mr.target_branch,
  };
}

function mapGLIssue(i: GLIssueResponse): Issue {
  return {
    ref: String(i.iid),
    title: i.title,
    url: i.web_url,
    state: i.state,
    labels: Array.isArray(i.labels) ? i.labels : [],
  };
}

// ── Internal types ──────────────────────────────────────────

interface MRResponse {
  iid: number;
  title: string;
  web_url: string;
  state: string;
  merged_at: string | null;
  author?: { username?: string };
  source_branch: string;
  target_branch: string;
}

interface ChangeEntry {
  old_path: string;
  new_path: string;
  diff: string | null;
  new_file: boolean;
  deleted_file: boolean;
  renamed_file: boolean;
}

interface GLIssueResponse {
  iid: number;
  title: string;
  web_url: string;
  state: string;
  labels: string[];
}
