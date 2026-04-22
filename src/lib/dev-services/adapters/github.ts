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
  RateLimitError,
  RetryableNetworkError,
} from "../types";

const API = "https://api.github.com";
const DEFAULT_TIMEOUT = 15_000;
const MAX_DIFF_TOKENS = 12_000;

export class GitHubClient
  implements DevServiceClient, CodeHostClient, WorkItemClient
{
  readonly service = "github";
  readonly capabilities: ServiceCapability[] = [
    "code_review",
    "issues",
    "test_gen",
    "summary",
    "branches",
  ];
  readonly getAvailableTransitions = undefined;

  constructor(
    private readonly accessToken: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT,
  ) {}

  asCodeHost(): CodeHostClient {
    return this;
  }
  asWorkItemTracker(): WorkItemClient {
    return this;
  }

  // ── User ────────────────────────────────────────────────

  async getAuthenticatedUser(): Promise<ServiceUser> {
    const u = await this.json<{ id: number; login: string; avatar_url?: string }>("/user");
    return { id: String(u.id), login: u.login, avatarUrl: u.avatar_url };
  }

  // ── Repos ───────────────────────────────────────────────

  async listRepos(): Promise<Repo[]> {
    const repos = await this.json<Array<{ full_name: string; name: string; html_url: string; default_branch: string }>>(
      "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
    );
    return repos.map((r) => ({
      ref: r.full_name,
      name: r.name,
      url: r.html_url,
      defaultBranch: r.default_branch,
    }));
  }

  async getFileContent(repoRef: string, path: string, ref?: string): Promise<string> {
    const { owner, repo } = split(repoRef);
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    return this.text(`/repos/${owner}/${repo}/contents/${encodePath(path)}${q}`, {
      headers: { Accept: "application/vnd.github.raw" },
    });
  }

  // ── Branches ────────────────────────────────────────────

  async createBranch(repoRef: string, branchName: string, fromRef?: string): Promise<Branch> {
    const { owner, repo } = split(repoRef);
    const sha = await this.resolveRefSha(repoRef, fromRef);
    await this.json(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
    });
    return {
      ref: branchName,
      name: branchName,
      url: `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(branchName)}`,
    };
  }

  // ── Merge Requests (PRs) ────────────────────────────────

  async getMergeRequest(repoRef: string, mrRef: string): Promise<MergeRequest> {
    return this.mapPR(await this.fetchPR(repoRef, mrRef));
  }

  async getMergeRequestDiff(repoRef: string, mrRef: string): Promise<string> {
    const { owner, repo } = split(repoRef);
    const raw = await this.text(`/repos/${owner}/${repo}/pulls/${mrRef}`, {
      headers: { Accept: "application/vnd.github.v3.diff" },
    });
    return truncateDiff(raw, MAX_DIFF_TOKENS);
  }

  async getMergeRequestFiles(repoRef: string, mrRef: string): Promise<ChangedFile[]> {
    const { owner, repo } = split(repoRef);
    const files = await this.json<Array<{ filename: string; status: string }>>(
      `/repos/${owner}/${repo}/pulls/${mrRef}/files?per_page=100`,
    );
    return files.map((f) => ({ path: f.filename, status: f.status }));
  }

  async createMergeRequest(
    repoRef: string,
    title: string,
    body: string,
    sourceBranch: string,
    targetBranch?: string,
  ): Promise<MergeRequest> {
    const { owner, repo } = split(repoRef);
    const base = targetBranch ?? (await this.getDefaultBranch(repoRef));
    const pr = await this.json<PRResponse>(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title, body, head: sourceBranch, base }),
    });
    return this.mapPR(pr);
  }

  async submitReview(
    repoRef: string,
    mrRef: string,
    body: string,
    comments: ReviewComment[],
    event: ReviewEvent,
  ): Promise<void> {
    const { owner, repo } = split(repoRef);
    const pr = await this.fetchPR(repoRef, mrRef);
    await this.json(`/repos/${owner}/${repo}/pulls/${mrRef}/reviews`, {
      method: "POST",
      body: JSON.stringify({
        body,
        event: event === "approve" ? "APPROVE" : event === "request_changes" ? "REQUEST_CHANGES" : "COMMENT",
        commit_id: pr.head.sha,
        comments: comments.map((c) => ({
          path: c.path,
          line: c.line,
          side: "RIGHT",
          body: formatComment(c),
        })),
      }),
    });
  }

  // ── Issues ──────────────────────────────────────────────

  async listIssues(projectRef: string, params: IssueListParams = {}): Promise<Issue[]> {
    const { owner, repo } = split(projectRef);
    const q = new URLSearchParams({
      state: params.state ?? "open",
      per_page: String(params.limit ?? 50),
    });
    if (params.labels?.length) q.set("labels", params.labels.join(","));
    const issues = await this.json<IssueResponse[]>(`/repos/${owner}/${repo}/issues?${q}`);
    return issues.filter((i) => !i.pull_request).map(mapIssue);
  }

  async createIssue(projectRef: string, title: string, body: string, opts: CreateIssueOptions = {}): Promise<Issue> {
    const { owner, repo } = split(projectRef);
    const labels = [...(opts.labels ?? [])];
    if (opts.priority) labels.push(`priority:${opts.priority}`);
    if (opts.issueType) labels.push(`type:${opts.issueType}`);
    const issue = await this.json<IssueResponse>(`/repos/${owner}/${repo}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title,
        body,
        labels,
        assignees: opts.assignee ? [opts.assignee] : undefined,
      }),
    });
    return mapIssue(issue);
  }

  async getIssue(projectRef: string, issueRef: string): Promise<Issue> {
    const { owner, repo } = split(projectRef);
    return mapIssue(await this.json<IssueResponse>(`/repos/${owner}/${repo}/issues/${issueRef}`));
  }

  async updateIssueStatus(projectRef: string, issueRef: string, status: string): Promise<Issue> {
    const { owner, repo } = split(projectRef);
    const s = status.trim().toLowerCase();
    const state = s === "closed" || s === "done" || s === "resolved" ? "closed" : "open";
    return mapIssue(
      await this.json<IssueResponse>(`/repos/${owner}/${repo}/issues/${issueRef}`, {
        method: "PATCH",
        body: JSON.stringify({ state }),
      }),
    );
  }

  // ── Internals ───────────────────────────────────────────

  private async fetchPR(repoRef: string, mrRef: string): Promise<PRResponse> {
    const { owner, repo } = split(repoRef);
    return this.json<PRResponse>(`/repos/${owner}/${repo}/pulls/${mrRef}`);
  }

  private async getDefaultBranch(repoRef: string): Promise<string> {
    const { owner, repo } = split(repoRef);
    const r = await this.json<{ default_branch: string }>(`/repos/${owner}/${repo}`);
    return r.default_branch;
  }

  private async resolveRefSha(repoRef: string, fromRef?: string): Promise<string> {
    const { owner, repo } = split(repoRef);
    const ref = fromRef ?? (await this.getDefaultBranch(repoRef));
    const c = await this.json<{ sha: string }>(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`);
    return c.sha;
  }

  private mapPR(pr: PRResponse): MergeRequest {
    return {
      ref: String(pr.number),
      title: pr.title,
      url: pr.html_url,
      state: pr.merged_at ? "merged" : pr.state,
      author: pr.user?.login ?? "unknown",
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref,
    };
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
      const res = await fetch(`${API}${path}`, {
        ...init,
        signal: ac.signal,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...init.headers,
        },
      });
      if (res.headers.get("X-RateLimit-Remaining") === "0") {
        const reset = Number(res.headers.get("X-RateLimit-Reset") ?? "0");
        throw new RateLimitError(this.service, Math.max(0, reset - Math.floor(Date.now() / 1000)));
      }
      if (res.status === 401) throw new AuthExpiredError(this.service);
      if (res.status === 404) throw new NotFoundError(this.service, path);
      if (res.status >= 500) throw new RetryableNetworkError(this.service, `${res.status}`);
      if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
      return res;
    } catch (e) {
      if (e instanceof AuthExpiredError || e instanceof NotFoundError || e instanceof RateLimitError || e instanceof RetryableNetworkError) throw e;
      if (e instanceof DOMException && e.name === "AbortError") throw new RetryableNetworkError(this.service, "timeout");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────

function split(ref: string) {
  const [owner, repo] = ref.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo ref: ${ref}`);
  return { owner, repo };
}

function encodePath(p: string) {
  return p.split("/").map(encodeURIComponent).join("/");
}

function formatComment(c: ReviewComment): string {
  const lines = [`[${c.severity.toUpperCase()}] ${c.body}`];
  if (c.suggestion) lines.push("", "```suggestion", c.suggestion, "```");
  return lines.join("\n");
}

function mapIssue(i: IssueResponse): Issue {
  return {
    ref: String(i.number),
    title: i.title,
    url: i.html_url,
    state: i.state,
    labels: i.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")),
  };
}

export function truncateDiff(diff: string, maxTokens: number): string {
  const est = (s: string) => Math.ceil(s.length / 4);
  if (est(diff) <= maxTokens) return diff;
  const sections = diff.split(/(?=^diff --git )/m).filter(Boolean);
  const kept: string[] = [];
  let used = 0;
  for (const sec of sections) {
    const tokens = est(sec);
    if (used + tokens > maxTokens) {
      kept.push(sec.split("\n").slice(0, 4).join("\n") + "\n... truncated ...\n");
      break;
    }
    kept.push(sec);
    used += tokens;
  }
  return kept.join("") || diff.slice(0, maxTokens * 4);
}

// ── Internal types ──────────────────────────────────────────

interface PRResponse {
  number: number;
  title: string;
  html_url: string;
  state: string;
  merged_at: string | null;
  user?: { login?: string };
  head: { ref: string; sha: string };
  base: { ref: string };
}

interface IssueResponse {
  number: number;
  title: string;
  html_url: string;
  state: string;
  labels: Array<{ name?: string } | string>;
  pull_request?: unknown;
}
