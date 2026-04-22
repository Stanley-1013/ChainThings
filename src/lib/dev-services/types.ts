// Dev Services — shared types, interfaces, and error classes

// ============================================================
// Resource Models
// ============================================================

export interface Repo {
  ref: string; // 'owner/repo' or 'group/project'
  name: string;
  url: string;
  defaultBranch: string;
}

export interface Branch {
  ref: string;
  name: string;
  url: string;
}

export interface MergeRequest {
  ref: string; // PR number or MR IID
  title: string;
  url: string;
  state: string; // 'open', 'merged', 'closed'
  author: string;
  sourceBranch: string;
  targetBranch: string;
}

export interface ChangedFile {
  path: string;
  status: string; // 'added', 'modified', 'removed', 'renamed'
}

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
  severity: "critical" | "warning" | "suggestion" | "praise";
  suggestion?: string;
}

export interface Issue {
  ref: string; // Issue number or Jira key
  title: string;
  url: string;
  state: string;
  labels: string[];
}

export interface Transition {
  id: string;
  name: string;
}

export interface ServiceUser {
  id: string;
  login: string;
  avatarUrl?: string;
}

// ============================================================
// Options
// ============================================================

export interface IssueListParams {
  state?: string;
  labels?: string[];
  limit?: number;
}

export interface CreateIssueOptions {
  labels?: string[];
  assignee?: string;
  priority?: string;
  issueType?: string;
  sprintId?: string;
  linkedBranch?: string;
  linkedService?: string;
}

export type ReviewEvent = "comment" | "approve" | "request_changes";

export type ServiceCapability =
  | "code_review"
  | "issues"
  | "test_gen"
  | "summary"
  | "branches"
  | "transitions";

// ============================================================
// Client Interfaces (capability-based)
// ============================================================

export interface CodeHostClient {
  readonly service: string;
  listRepos(): Promise<Repo[]>;
  getFileContent(repoRef: string, path: string, ref?: string): Promise<string>;
  createBranch(
    repoRef: string,
    branchName: string,
    fromRef?: string,
  ): Promise<Branch>;
  getMergeRequest(repoRef: string, mrRef: string): Promise<MergeRequest>;
  getMergeRequestDiff(repoRef: string, mrRef: string): Promise<string>;
  getMergeRequestFiles(repoRef: string, mrRef: string): Promise<ChangedFile[]>;
  createMergeRequest(
    repoRef: string,
    title: string,
    body: string,
    sourceBranch: string,
    targetBranch?: string,
  ): Promise<MergeRequest>;
  submitReview(
    repoRef: string,
    mrRef: string,
    body: string,
    comments: ReviewComment[],
    event: ReviewEvent,
  ): Promise<void>;
}

export interface WorkItemClient {
  listIssues(projectRef: string, params?: IssueListParams): Promise<Issue[]>;
  createIssue(
    projectRef: string,
    title: string,
    body: string,
    options?: CreateIssueOptions,
  ): Promise<Issue>;
  getIssue(projectRef: string, issueRef: string): Promise<Issue>;
  updateIssueStatus(
    projectRef: string,
    issueRef: string,
    status: string,
  ): Promise<Issue>;
  getAvailableTransitions?(
    projectRef: string,
    issueRef: string,
  ): Promise<Transition[]>;
}

export interface DevServiceClient {
  readonly service: string;
  readonly capabilities: ServiceCapability[];
  getAuthenticatedUser(): Promise<ServiceUser>;
  asCodeHost?(): CodeHostClient | undefined;
  asWorkItemTracker?(): WorkItemClient | undefined;
}

// ============================================================
// Config Types
// ============================================================

export interface DevServicePublicConfig {
  auth_type: "oauth2" | "api_token" | "app_installation";
  external_user_id?: string;
  external_avatar_url?: string;
  token_expires_at?: string;
  auto_review_enabled: boolean;
  auto_review_repos: string[];
  review_language: string;
  scopes?: string[];
  github?: { installation_id?: number; app_id?: number };
  gitlab?: { base_url?: string };
  jira?: {
    domain: string;
    email: string;
    projects: string[];
    status_mapping?: {
      mr_opened?: string;
      mr_merged?: string;
    };
  };
}

export interface DevServiceSecretConfig {
  access_token: string;
  refresh_token?: string;
  api_token?: string;
}

// ============================================================
// Credential Strategy
// ============================================================

export interface TokenResult {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export interface ResolvedCredential {
  token: string;
  expiresAt?: Date;
}

export interface CredentialStrategy {
  readonly authType: "oauth2" | "api_token" | "app_installation";
  requiresOAuth(): boolean;
  getAuthorizationUrl?(state: string): string;
  exchangeCodeForToken?(code: string): Promise<TokenResult>;
  resolveCredential(
    secretConfig: DevServiceSecretConfig,
    publicConfig: DevServicePublicConfig,
  ): Promise<ResolvedCredential>;
  refreshIfNeeded?(
    current: ResolvedCredential,
  ): Promise<ResolvedCredential | null>;
}

// ============================================================
// Webhook
// ============================================================

export interface WebhookVerifier {
  verify(payload: string, headers: Headers, secret: string): boolean;
  getDeliveryId(headers: Headers): string | null;
  getEventType(headers: Headers, payload: unknown): string;
}

export interface NormalizedEvent {
  eventName: string;
  actor: { id: string; login: string };
  resource: {
    type: "merge_request" | "issue" | "comment";
    ref: string;
    repoRef: string;
    url: string;
    title?: string;
    body?: string;
    sourceBranch?: string;
    state?: string;
  };
  dedupeKey: string;
  normalizedPayload: unknown;
}

export type EventNormalizerFn = (
  rawEventType: string,
  payload: unknown,
) => NormalizedEvent | null;

// ============================================================
// Error Types
// ============================================================

export class DevServiceError extends Error {
  constructor(
    public readonly service: string,
    message: string,
  ) {
    super(message);
    this.name = "DevServiceError";
  }
}

export class RateLimitError extends DevServiceError {
  constructor(
    service: string,
    public readonly retryAfter: number,
  ) {
    super(service, `Rate limited. Retry after ${retryAfter}s`);
    this.name = "RateLimitError";
  }
}

export class AuthExpiredError extends DevServiceError {
  constructor(service: string) {
    super(service, "Authentication expired. Please re-authenticate.");
    this.name = "AuthExpiredError";
  }
}

export class PermissionDeniedError extends DevServiceError {
  constructor(service: string, detail?: string) {
    super(service, detail ?? "Permission denied");
    this.name = "PermissionDeniedError";
  }
}

export class NotFoundError extends DevServiceError {
  constructor(service: string, resource: string) {
    super(service, `Not found: ${resource}`);
    this.name = "NotFoundError";
  }
}

export class RetryableNetworkError extends DevServiceError {
  constructor(service: string, cause?: string) {
    super(service, cause ?? "Network error (retryable)");
    this.name = "RetryableNetworkError";
  }
}

export class UnsupportedCapabilityError extends DevServiceError {
  constructor(service: string, capability: string) {
    super(service, `Capability not supported: ${capability}`);
    this.name = "UnsupportedCapabilityError";
  }
}

export class WebhookVerificationError extends DevServiceError {
  constructor(service: string) {
    super(service, "Webhook signature verification failed");
    this.name = "WebhookVerificationError";
  }
}
