import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HedyClient, HedyApiError } from "@/lib/integrations/hedy/client";
import type { HedySession } from "@/lib/integrations/hedy/client";
import {
  createMockSupabaseClient,
  mockProfile,
} from "@/__tests__/mocks/supabase";
import { getJsonResponse } from "@/__tests__/helpers";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/integrations/hedy/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/integrations/hedy/client")>();
  return { ...actual, HedyClient: vi.fn(), HedyApiError: actual.HedyApiError };
});

const mockCreateClient = vi.mocked(createClient);
const mockSupabaseAdminFrom = vi.mocked(supabaseAdmin.from);
const mockHedyClient = vi.mocked(HedyClient);

interface IntegrationRow {
  config: { api_key?: string };
}

interface SetupAdminOptions {
  integration?: IntegrationRow | null;
  existingItems?: Record<string, { id: string } | null>;
  insertItemError?: { code?: string; message: string } | null;
  memoryInsertError?: { message: string } | null;
}

function setupClient(profile: typeof mockProfile | null = mockProfile) {
  const client = createMockSupabaseClient();

  client.from = vi.fn((table: string) => {
    if (table === "chainthings_profiles") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => ({ data: profile, error: null })),
          })),
        })),
      } as never;
    }
    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
  return client;
}

function setupAdmin(options: SetupAdminOptions = {}) {
  const itemInserts: unknown[] = [];
  const memoryInserts: unknown[] = [];
  const integration =
    options.integration === undefined
      ? { config: { api_key: "hedy-key" } }
      : options.integration;
  const existingItems = options.existingItems ?? {};

  mockSupabaseAdminFrom.mockImplementation((table: string) => {
    if (table === "chainthings_integrations") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                single: vi.fn(() => ({ data: integration, error: null })),
              })),
            })),
          })),
        })),
      } as never;
    }

    if (table === "chainthings_items") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn((_column: string, externalId: string) => ({
              single: vi.fn(() => ({
                data: existingItems[externalId] ?? null,
                error: null,
              })),
            })),
          })),
        })),
        insert: vi.fn((payload: unknown) => {
          itemInserts.push(payload);
          return {
            select: vi.fn(() => ({
              single: vi.fn(() => ({
                data: options.insertItemError ? null : { id: "item-new" },
                error: options.insertItemError ?? null,
              })),
            })),
          };
        }),
      } as never;
    }

    if (table === "chainthings_memory_entries") {
      return {
        insert: vi.fn((payload: unknown) => {
          memoryInserts.push(payload);
          return { error: options.memoryInsertError ?? null };
        }),
      } as never;
    }

    return {} as never;
  });

  return { itemInserts, memoryInserts };
}

function setupHedyClient(options: {
  stubs?: Pick<HedySession, "sessionId">[];
  sessions?: Record<string, HedySession>;
  iterateError?: Error;
  sessionErrors?: Record<string, Error>;
} = {}) {
  const getSession = vi.fn(async (sessionId: string) => {
    const error = options.sessionErrors?.[sessionId];
    if (error) throw error;
    return options.sessions?.[sessionId] ?? mockSession(sessionId);
  });

  const iterateAllSessionIds = vi.fn(async function* () {
    if (options.iterateError) throw options.iterateError;
    for (const stub of options.stubs ?? []) {
      yield stub;
    }
  });

  mockHedyClient.mockImplementation(function HedyClientMock() {
    return {
      iterateAllSessionIds,
      getSession,
    } as never;
  });

  return { iterateAllSessionIds, getSession };
}

function mockSession(
  sessionId: string,
  overrides: Partial<HedySession> = {},
): HedySession {
  return {
    sessionId,
    title: `Session ${sessionId}`,
    transcript: `Transcript ${sessionId}`,
    recap: `Recap ${sessionId}`,
    meeting_minutes: `Minutes ${sessionId}`,
    user_todos: [],
    ...overrides,
  };
}

async function postBackfill() {
  const responsePromise = POST();
  await vi.runAllTimersAsync();
  return responsePromise;
}

describe("POST /api/integrations/hedy/backfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setupClient();
    setupAdmin();
    setupHedyClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should return 401 for unauthenticated user", async () => {
    const client = createMockSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as never);

    const response = await postBackfill();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when profile not found", async () => {
    setupClient(null);

    const response = await postBackfill();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  it("should return 400 when hedy integration does not exist", async () => {
    setupAdmin({ integration: null });

    const response = await postBackfill();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("No Hedy API key configured");
  });

  it("should return 400 when api key is redacted", async () => {
    setupAdmin({ integration: { config: { api_key: "sk-••••" } } });

    const response = await postBackfill();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("No Hedy API key configured");
  });

  it("should import new sessions and skip existing sessions", async () => {
    const sessions = {
      s2: mockSession("s2", { title: "New Meeting" }),
    };
    const { itemInserts } = setupAdmin({
      existingItems: { s1: { id: "item-existing" }, s2: null },
    });
    const { getSession } = setupHedyClient({
      stubs: [{ sessionId: "s1" }, { sessionId: "s2" }],
      sessions,
    });

    const response = await postBackfill();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ imported: 1, skipped: 1, errors: 0 });
    expect(getSession).toHaveBeenCalledOnce();
    expect(getSession).toHaveBeenCalledWith("s2");
    expect(itemInserts).toHaveLength(1);
    expect(itemInserts[0]).toMatchObject({
      tenant_id: "tenant-456",
      type: "meeting_note",
      title: "New Meeting",
      external_id: "s2",
    });
  });

  it("should write active todos and only persist valid ISO due dates", async () => {
    const validDueDate = "2026-05-01T10:30:00.000Z";
    const { memoryInserts } = setupAdmin({ existingItems: { s1: null } });
    setupHedyClient({
      stubs: [{ sessionId: "s1" }],
      sessions: {
        s1: mockSession("s1", {
          user_todos: [
            {
              id: "todo-1",
              sessionId: "s1",
              text: "Send notes",
              dueDate: validDueDate,
              completed: false,
            },
            {
              id: "todo-2",
              sessionId: "s1",
              text: "Schedule follow-up",
              dueDate: "next week",
              completed: false,
            },
            {
              id: "todo-3",
              sessionId: "s1",
              text: "Completed item",
              completed: true,
            },
          ],
        }),
      },
    });

    const response = await postBackfill();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ imported: 1, skipped: 0, errors: 0 });
    expect(memoryInserts).toHaveLength(1);
    expect(memoryInserts[0]).toEqual([
      {
        tenant_id: "tenant-456",
        category: "task",
        content: "Send notes",
        importance: 7,
        source_type: "item",
        source_id: "item-new",
        due_date: validDueDate,
      },
      {
        tenant_id: "tenant-456",
        category: "task",
        content: "Schedule follow-up",
        importance: 7,
        source_type: "item",
        source_id: "item-new",
      },
    ]);
  });

  it("should count unique-violation insert races as skipped", async () => {
    setupAdmin({
      existingItems: { s1: null },
      insertItemError: { code: "23505", message: "duplicate key value" },
    });
    setupHedyClient({ stubs: [{ sessionId: "s1" }] });

    const response = await postBackfill();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ imported: 0, skipped: 1, errors: 0 });
  });

  it("should map top-level Hedy auth errors to 400", async () => {
    setupHedyClient({
      iterateError: new HedyApiError("Invalid API key", 401),
    });

    const response = await postBackfill();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "Invalid API key",
      imported: 0,
      skipped: 0,
      errors: 0,
    });
  });

  it("should map top-level Hedy server errors to 502", async () => {
    setupHedyClient({
      iterateError: new HedyApiError("Hedy unavailable", 500),
    });

    const response = await postBackfill();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: "Hedy unavailable",
      imported: 0,
      skipped: 0,
      errors: 0,
    });
  });

  it("should continue after per-session Hedy rate limit errors", async () => {
    setupAdmin({ existingItems: { s1: null, s2: null } });
    setupHedyClient({
      stubs: [{ sessionId: "s1" }, { sessionId: "s2" }],
      sessionErrors: {
        s1: new HedyApiError("Rate limited", 429, { retryAfter: 1 }),
      },
      sessions: {
        s2: mockSession("s2"),
      },
    });

    const response = await postBackfill();
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ imported: 1, skipped: 0, errors: 1 });
  });
});
