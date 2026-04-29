import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  createMockSupabaseClient,
  mockProfile,
  mockUser,
} from "@/__tests__/mocks/supabase";
import { createGetRequest, getJsonResponse } from "@/__tests__/helpers";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

const mockCreateClient = vi.mocked(createClient);
const mockSupabaseAdminFrom = vi.mocked(supabaseAdmin.from);

interface NotificationSetting {
  tenant_id: string;
  user_id: string;
  timezone: string;
  frequency: string;
  send_hour_local: number | null;
  last_generated_at?: string | null;
}

interface QueryError {
  message: string;
}

function createChain() {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn<() => { data: unknown; error: null }>(() => ({
      data: null,
      error: null,
    })),
  };
  return chain;
}

function setupClient(options: {
  user?: typeof mockUser | null;
  profile?: typeof mockProfile | null;
  settings?: unknown | null;
} = {}) {
  const client = createMockSupabaseClient({
    user: options.user === undefined ? mockUser : options.user,
  });
  const profile = options.profile === undefined ? mockProfile : options.profile;
  const profileChain = createChain();
  const settingsChain = createChain();
  profileChain.single.mockReturnValue({ data: profile, error: null });
  settingsChain.single.mockReturnValue({
    data: options.settings ?? {
      timezone: "UTC",
      frequency: "weekly",
      send_hour_local: 9,
    },
    error: null,
  });

  client.from = vi.fn((table: string) => {
    if (table === "chainthings_profiles") return profileChain as never;
    if (table === "chainthings_notification_settings") return settingsChain as never;
    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
  return { profileChain, settingsChain };
}

function setupAdmin(options: {
  cronSettings?: NotificationSetting[] | null;
  cacheWatermark?: string | null;
  itemsCount?: number;
  tasksCount?: number;
  urgentCount?: number;
  items?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
  deadlines?: Array<Record<string, unknown>>;
  itemsCountError?: QueryError | null;
  tasksCountError?: QueryError | null;
  urgentCountError?: QueryError | null;
  fetchItemsError?: QueryError | null;
  fetchTasksError?: QueryError | null;
  fetchDeadlinesError?: QueryError | null;
} = {}) {
  const cacheUpserts: unknown[] = [];
  const settingsUpdates: unknown[] = [];
  const cronSettings = options.cronSettings ?? [];

  mockSupabaseAdminFrom.mockImplementation((table: string) => {
    if (table === "chainthings_notification_settings") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ data: cronSettings, error: null })),
        })),
        update: vi.fn((payload: unknown) => {
          settingsUpdates.push(payload);
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({ data: null, error: null })),
            })),
          };
        }),
      } as never;
    }

    if (table === "chainthings_notification_cache") {
      return {
        select: vi.fn(() => {
          const chain = {
            eq: vi.fn(() => chain),
            order: vi.fn(() => chain),
            limit: vi.fn(() => ({
              data: options.cacheWatermark
                ? [{ source_watermark: options.cacheWatermark }]
                : [],
              error: null,
            })),
          };
          return chain;
        }),
        upsert: vi.fn((payload: unknown) => {
          cacheUpserts.push(payload);
          return { data: payload, error: null };
        }),
      } as never;
    }

    if (table === "chainthings_items") {
      return {
        select: vi.fn((_columns: string, queryOptions?: { head?: boolean }) => {
          if (queryOptions?.head) {
            const chain = {
              eq: vi.fn(() => chain),
              or: vi.fn(() => ({
                count: options.itemsCount ?? 1,
                error: options.itemsCountError ?? null,
              })),
            };
            return chain;
          }

          const chain = {
            eq: vi.fn(() => chain),
            gte: vi.fn(() => chain),
            order: vi.fn(() => chain),
            limit: vi.fn(() => ({
              data: options.items ?? [
                {
                  title: "Product sync",
                  metadata: {
                    summary: "Discussed rollout blockers",
                    keyPoints: ["Finalize rollout owner"],
                  },
                  created_at: "2026-04-29T00:10:00.000Z",
                  updated_at: "2026-04-29T00:20:00.000Z",
                },
              ],
              error: options.fetchItemsError ?? null,
            })),
          };
          return chain;
        }),
      } as never;
    }

    if (table === "chainthings_memory_entries") {
      return {
        select: vi.fn((columns: string, queryOptions?: { head?: boolean }) => {
          const state = { urgent: false };
          const chain = {
            eq: vi.fn(() => chain),
            not: vi.fn(() => {
              state.urgent = true;
              return chain;
            }),
            lte: vi.fn(() => chain),
            or: vi.fn(() => ({
              count: state.urgent ? options.urgentCount ?? 0 : options.tasksCount ?? 1,
              error: state.urgent
                ? options.urgentCountError ?? null
                : options.tasksCountError ?? null,
            })),
            order: vi.fn(() => chain),
            limit: vi.fn(() => {
              if (columns.includes("due_date")) {
                return {
                  data: options.deadlines ?? [
                    {
                      content: "Send customer follow-up",
                      due_date: "2026-04-30T00:00:00.000Z",
                    },
                  ],
                  error: options.fetchDeadlinesError ?? null,
                };
              }
              return {
                data: options.tasks ?? [
                  {
                    category: "task",
                    content: "Prepare launch notes",
                    created_at: "2026-04-29T00:30:00.000Z",
                    updated_at: "2026-04-29T00:40:00.000Z",
                  },
                ],
                error: options.fetchTasksError ?? null,
              };
            }),
          };

          if (queryOptions?.head) return chain;
          return chain;
        }),
      } as never;
    }

    return {} as never;
  });

  return { cacheUpserts, settingsUpdates };
}

function postGenerate(request: Request = createGetRequest("http://localhost/api/notifications/generate")) {
  return POST(request);
}

describe("/api/notifications/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T01:00:00.000Z"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.CRON_SECRET = "cron-secret";
    setupClient();
    setupAdmin();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.CRON_SECRET;
  });

  it("should return 401 for unauthenticated manual generation", async () => {
    setupClient({ user: null });

    const response = await postGenerate();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when manual generation has no profile", async () => {
    setupClient({ profile: null });

    const response = await postGenerate();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  it("should no-op manual generation during cooldown when there is no new data", async () => {
    setupAdmin({
      cacheWatermark: "2026-04-29T00:59:30.000Z",
      itemsCount: 0,
      tasksCount: 0,
      urgentCount: 0,
    });

    const response = await postGenerate();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: { generated: 0, skipped: true, reason: "no_new_data" },
    });
  });

  it("should generate a manual notification with deterministic summary content", async () => {
    const { cacheUpserts, settingsUpdates } = setupAdmin({
      cacheWatermark: "2026-04-28T23:00:00.000Z",
    });

    const response = await postGenerate();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { generated: 1, skipped: 0 } });
    expect(cacheUpserts).toHaveLength(1);
    expect(cacheUpserts[0]).toMatchObject({
      tenant_id: "tenant-456",
      user_id: "user-123",
      content: {
        summary: "Discussed rollout blockers",
        keyPoints: ["Finalize rollout owner"],
        actionItems: [{ task: "Prepare launch notes", priority: "medium" }],
        reminders: [expect.stringContaining("Send customer follow-up")],
        recentMeetings: [
          {
            title: "Product sync",
            date: "2026-04-29T00:10:00.000Z",
          },
        ],
      },
      status: "generated",
    });
    expect(settingsUpdates).toHaveLength(1);
  });

  it("should return generated zero when cron has no enabled settings", async () => {
    setupAdmin({ cronSettings: [] });
    const request = createGetRequest("http://localhost/api/notifications/generate");
    request.headers.set("authorization", "Bearer cron-secret");

    const response = await postGenerate(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { generated: 0 } });
  });

  it("should generate for cron targets whose local hour matches send_hour_local", async () => {
    const { cacheUpserts } = setupAdmin({
      cronSettings: [
        {
          tenant_id: "tenant-cron",
          user_id: "user-cron",
          timezone: "Asia/Taipei",
          frequency: "daily",
          send_hour_local: 9,
          last_generated_at: null,
        },
      ],
    });
    const request = createGetRequest("http://localhost/api/notifications/generate");
    request.headers.set("authorization", "Bearer cron-secret");

    const response = await postGenerate(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { generated: 1, skipped: 0 } });
    expect(cacheUpserts[0]).toMatchObject({
      tenant_id: "tenant-cron",
      user_id: "user-cron",
    });
  });

  it("should skip cron targets when local hour does not match send_hour_local", async () => {
    const { cacheUpserts } = setupAdmin({
      cronSettings: [
        {
          tenant_id: "tenant-cron",
          user_id: "user-cron",
          timezone: "Asia/Taipei",
          frequency: "daily",
          send_hour_local: 10,
          last_generated_at: null,
        },
      ],
    });
    const request = createGetRequest("http://localhost/api/notifications/generate");
    request.headers.set("authorization", "Bearer cron-secret");

    const response = await postGenerate(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { generated: 0, skipped: 0 } });
    expect(cacheUpserts).toHaveLength(0);
  });

  it("should skip generation when no source data changed after the watermark", async () => {
    setupAdmin({
      cacheWatermark: "2026-04-28T23:00:00.000Z",
      itemsCount: 0,
      tasksCount: 0,
      urgentCount: 0,
    });

    const response = await postGenerate();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { generated: 0, skipped: 1, reason: "no_new_data" } });
  });

  it("should continue and log when a target generation query fails", async () => {
    setupAdmin({
      fetchItemsError: { message: "items failed" },
    });

    const response = await postGenerate();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { generated: 0, skipped: 0 } });
    expect(console.error).toHaveBeenCalledWith(
      "Failed to generate notification for user-123:",
      expect.any(Error),
    );
  });

  it("should delegate GET requests to POST", async () => {
    setupAdmin({
      cacheWatermark: "2026-04-28T23:00:00.000Z",
    });
    const request = createGetRequest("http://localhost/api/notifications/generate");

    const response = await GET(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { generated: 1, skipped: 0 } });
  });
});
