import {
  HedyApiError,
  HedyListResponse,
  HedySession,
  HedyHighlight,
  HedyTodo,
  HedyTopic,
  HedyUser,
  HedyRegisteredWebhook,
  HedySingleResponse,
} from "./types";

export { HedyApiError } from "./types";
export type {
  HedySession,
  HedyHighlight,
  HedyTodo,
  HedyTopic,
  HedyUser,
  HedyRegisteredWebhook,
} from "./types";

const DEFAULT_TIMEOUT_MS = Number(process.env.HEDY_TIMEOUT_MS) || 30_000;
const DEFAULT_REGION = (process.env.HEDY_REGION || "us").toLowerCase();
const BASE_URLS: Record<string, string> = {
  us: "https://api.hedy.bot",
  eu: "https://eu-api.hedy.bot",
};
const MAX_PAGE_LIMIT = 100;

export interface HedyClientOptions {
  apiKey: string;
  region?: "us" | "eu";
  timeoutMs?: number;
}

export interface ListOptions {
  limit?: number;
  after?: string;
}

export class HedyClient {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(opts: HedyClientOptions) {
    if (!opts.apiKey) throw new Error("Hedy API key is required");
    this.apiKey = opts.apiKey;
    const region = (opts.region ?? DEFAULT_REGION) as "us" | "eu";
    this.baseUrl = BASE_URLS[region] ?? BASE_URLS.us;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(init?.headers ?? {}),
        },
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after")) || 30;
        throw new HedyApiError(`Rate limited (retry after ${retryAfter}s)`, 429, {
          retryAfter,
        });
      }

      const text = await res.text();
      const body = text ? safeJson(text) : null;

      if (!res.ok) {
        let msg = `Hedy API ${res.status}`;
        if (body && typeof body === "object" && "error" in body) {
          const errField = (body as Record<string, unknown>).error;
          if (typeof errField === "string" && errField.length > 0) msg = errField;
        }
        throw new HedyApiError(msg, res.status, body);
      }

      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildQuery(opts?: ListOptions): string {
    if (!opts) return "";
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", String(Math.min(opts.limit, MAX_PAGE_LIMIT)));
    if (opts.after) params.set("after", opts.after);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  /** Smoke test: confirm API key is valid. */
  async getMe(): Promise<HedyUser> {
    const res = await this.request<HedySingleResponse<HedyUser>>("/me");
    return res.data;
  }

  async listSessions(opts?: ListOptions): Promise<HedyListResponse<HedySession>> {
    return this.request<HedyListResponse<HedySession>>(
      `/sessions${this.buildQuery(opts)}`,
    );
  }

  async getSession(sessionId: string): Promise<HedySession> {
    const res = await this.request<HedySingleResponse<HedySession>>(
      `/sessions/${encodeURIComponent(sessionId)}`,
    );
    return res.data;
  }

  async listSessionHighlights(
    sessionId: string,
    opts?: ListOptions,
  ): Promise<HedyListResponse<HedyHighlight>> {
    return this.request<HedyListResponse<HedyHighlight>>(
      `/sessions/${encodeURIComponent(sessionId)}/highlights${this.buildQuery(opts)}`,
    );
  }

  async listSessionTodos(
    sessionId: string,
    opts?: ListOptions,
  ): Promise<HedyListResponse<HedyTodo>> {
    return this.request<HedyListResponse<HedyTodo>>(
      `/sessions/${encodeURIComponent(sessionId)}/todos${this.buildQuery(opts)}`,
    );
  }

  async listTopics(opts?: ListOptions): Promise<HedyListResponse<HedyTopic>> {
    return this.request<HedyListResponse<HedyTopic>>(
      `/topics${this.buildQuery(opts)}`,
    );
  }

  async listWebhooks(): Promise<HedyListResponse<HedyRegisteredWebhook>> {
    return this.request<HedyListResponse<HedyRegisteredWebhook>>("/webhooks");
  }

  async createWebhook(
    url: string,
    events: string[],
  ): Promise<HedyRegisteredWebhook> {
    const res = await this.request<HedySingleResponse<HedyRegisteredWebhook>>(
      "/webhooks",
      {
        method: "POST",
        body: JSON.stringify({ url, events }),
      },
    );
    return res.data;
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.request<unknown>(`/webhooks/${encodeURIComponent(webhookId)}`, {
      method: "DELETE",
    });
  }

  /**
   * Yields every session ID + basic info across pagination.
   * List endpoint only returns summary fields — use getSession() for full content.
   */
  async *iterateAllSessionIds(pageLimit = MAX_PAGE_LIMIT): AsyncGenerator<HedySession> {
    let after: string | undefined;
    while (true) {
      const page = await this.listSessions({ limit: pageLimit, after });
      for (const s of page.data ?? []) yield s;
      if (!page.pagination?.hasMore || !page.pagination.next) return;
      after = page.pagination.next;
    }
  }

  /**
   * Yields every session with FULL content (transcript, recap, todos, highlights).
   * Makes one extra API call per session. Caller should pace for rate limits.
   */
  async *iterateAllSessions(pageLimit = MAX_PAGE_LIMIT): AsyncGenerator<HedySession> {
    for await (const stub of this.iterateAllSessionIds(pageLimit)) {
      const full = await this.getSession(stub.sessionId);
      yield full;
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Load the tenant's Hedy API key from the integrations table and build a client. */
export async function buildHedyClientForTenant(
  admin: {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => {
            single: () => Promise<{
              data: { config: Record<string, unknown> | null } | null;
              error: unknown;
            }>;
          };
        };
      };
    };
  },
  tenantId: string,
): Promise<HedyClient | null> {
  const { data } = await admin
    .from("chainthings_integrations")
    .select("config")
    .eq("tenant_id", tenantId)
    .eq("service", "hedy.ai")
    .single();
  const apiKey = data?.config?.api_key;
  if (typeof apiKey !== "string" || apiKey.length === 0 || apiKey.includes("•")) {
    return null;
  }
  return new HedyClient({ apiKey });
}
