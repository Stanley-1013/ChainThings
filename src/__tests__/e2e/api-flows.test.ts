/**
 * E2E Integration Tests — Full API User Flows
 *
 * Tests complete user journeys across multiple API endpoints with mocked
 * Supabase, AI Gateway, and n8n services. Each flow simulates a real user
 * session from authentication through multi-step operations.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { chatCompletion } from "@/lib/ai-gateway";
import {
  createWorkflow,
  activateWorkflow,
  getWorkflow,
  listWorkflows,
} from "@/lib/n8n/client";
import { generateHedyWebhookWorkflow } from "@/lib/n8n/templates/hedy-webhook";
import { mockChatResponse } from "@/__tests__/mocks/openclaw";
import { mockN8nWorkflow, mockActivatedWorkflow } from "@/__tests__/mocks/n8n";
import { mockUser, mockProfile } from "@/__tests__/mocks/supabase";
import { getJsonResponse } from "@/__tests__/helpers";

const mockCreateClient = vi.mocked(createClient);
const mockChatCompletion = vi.mocked(chatCompletion);
const mockCreateWorkflow = vi.mocked(createWorkflow);
const mockActivateWorkflow = vi.mocked(activateWorkflow);
const mockGetWorkflow = vi.mocked(getWorkflow);
const mockListWorkflows = vi.mocked(listWorkflows);
const mockGenerateTemplate = vi.mocked(generateHedyWebhookWorkflow);

// ──────────────────────────────────────────────────────────────────────────────
// Shared mock DB state — simulates in-memory Supabase tables
// ──────────────────────────────────────────────────────────────────────────────

interface MockDB {
  profiles: Record<string, unknown>[];
  conversations: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  integrations: Record<string, unknown>[];
  workflows: Record<string, unknown>[];
  notification_settings: Record<string, unknown>[];
  items: Record<string, unknown>[];
}

function createMockDB(): MockDB {
  return {
    profiles: [
      { id: mockUser.id, display_name: "Test User", tenant_id: mockProfile.tenant_id },
    ],
    conversations: [],
    messages: [],
    integrations: [],
    workflows: [],
    notification_settings: [],
    items: [],
  };
}

/**
 * Creates a Supabase client mock that routes queries to the in-memory DB.
 * Supports: select, insert, upsert, update, delete, single, maybeSingle, order, range, eq, in, limit
 */
function createE2EClient(db: MockDB) {
  const client = {
    auth: {
      getUser: vi.fn(() => ({ data: { user: mockUser } })),
      signOut: vi.fn(() => ({})),
    },
    from: vi.fn((table: string) => {
      const tableMap: Record<string, Record<string, unknown>[]> = {
        chainthings_profiles: db.profiles,
        chainthings_conversations: db.conversations,
        chainthings_messages: db.messages,
        chainthings_integrations: db.integrations,
        chainthings_workflows: db.workflows,
        chainthings_notification_settings: db.notification_settings,
        chainthings_items: db.items,
      };

      const rows = tableMap[table] || [];

      // Build a chainable query mock
      function createQuery(filtered: Record<string, unknown>[]) {
        const q: Record<string, unknown> = {};

        q.eq = vi.fn((field: string, value: unknown) => {
          const next = filtered.filter((r) => r[field] === value);
          return createQuery(next);
        });

        q.in = vi.fn((_field: string, _values: unknown[]) => {
          return createQuery(filtered);
        });

        q.order = vi.fn(() => createQuery(filtered));
        q.range = vi.fn((_from: number, _to: number) => createQuery(filtered.slice(_from, _to + 1)));
        q.limit = vi.fn((_n: number) => createQuery(filtered.slice(0, _n)));

        q.single = vi.fn(() => ({
          data: filtered[0] || null,
          error: filtered[0] ? null : { code: "PGRST116", message: "not found" },
        }));

        q.maybeSingle = vi.fn(() => ({
          data: filtered[0] || null,
          error: null,
        }));

        // Terminal — return as array
        Object.defineProperty(q, "data", { get: () => filtered });
        Object.defineProperty(q, "error", { get: () => null });

        // select returns chainable
        q.select = vi.fn(() => createQuery(filtered));

        return q;
      }

      function insertOp(row: Record<string, unknown>) {
        const newRow = { ...row, id: row.id || crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        rows.push(newRow);
        return {
          select: vi.fn(() => ({
            single: vi.fn(() => ({ data: newRow, error: null })),
          })),
          error: null,
        };
      }

      function upsertOp(row: Record<string, unknown>) {
        const existingIdx = rows.findIndex((r) =>
          row.tenant_id && row.service
            ? r.tenant_id === row.tenant_id && r.service === row.service
            : r.id === row.id
        );
        const newRow = { ...(existingIdx >= 0 ? rows[existingIdx] : {}), ...row, id: existingIdx >= 0 ? rows[existingIdx].id : crypto.randomUUID(), updated_at: new Date().toISOString() };
        if (existingIdx >= 0) {
          rows[existingIdx] = newRow;
        } else {
          (newRow as Record<string, unknown>).created_at = new Date().toISOString();
          rows.push(newRow);
        }
        return {
          select: vi.fn(() => ({
            single: vi.fn(() => ({ data: newRow, error: null })),
          })),
        };
      }

      function updateOp(patch: Record<string, unknown>) {
        return {
          eq: vi.fn((field: string, value: unknown) => {
            const targets = rows.filter((r) => r[field] === value);
            return {
              eq: vi.fn((f2: string, v2: unknown) => {
                const matched = targets.filter((r) => r[f2] === v2);
                matched.forEach((r) => Object.assign(r, patch, { updated_at: new Date().toISOString() }));
                return {
                  select: vi.fn(() => ({
                    single: vi.fn(() => ({ data: matched[0] || null, error: null })),
                    maybeSingle: vi.fn(() => ({ data: matched[0] || null, error: null })),
                  })),
                  error: null,
                };
              }),
              select: vi.fn(() => ({
                single: vi.fn(() => {
                  targets.forEach((r) => Object.assign(r, patch));
                  return { data: targets[0] || null, error: null };
                }),
              })),
              error: null,
            };
          }),
        };
      }

      function deleteOp() {
        return {
          eq: vi.fn((field: string, value: unknown) => {
            const before = rows.length;
            const remaining = rows.filter((r) => r[field] !== value);
            rows.length = 0;
            rows.push(...remaining);
            return {
              eq: vi.fn((f2: string, v2: unknown) => {
                const remaining2 = rows.filter((r) => !(r[field] === value && r[f2] === v2));
                rows.length = 0;
                rows.push(...remaining2);
                return { error: null };
              }),
              error: null,
            };
          }),
        };
      }

      return {
        select: vi.fn(() => createQuery(rows)),
        insert: vi.fn((row: Record<string, unknown>) => insertOp(row)),
        upsert: vi.fn((row: Record<string, unknown>, _opts?: unknown) => upsertOp(row)),
        update: vi.fn((patch: Record<string, unknown>) => updateOp(patch)),
        delete: vi.fn(() => deleteOp()),
      } as never;
    }),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(() => ({ error: null })),
      })),
    },
  };

  mockCreateClient.mockResolvedValue(client as never);
  return client;
}

// ──────────────────────────────────────────────────────────────────────────────
// E2E Test Flows
// ──────────────────────────────────────────────────────────────────────────────

describe("E2E: Profile Management Flow", () => {
  let db: MockDB;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDB();
    createE2EClient(db);
  });

  it("should complete full profile flow: read → update → verify", async () => {
    const { GET, PATCH } = await import("@/app/api/profile/route");

    // Step 1: Read initial profile
    const getRes = await GET();
    const profile = await getJsonResponse(getRes);
    expect(getRes.status).toBe(200);
    expect(profile.data.display_name).toBe("Test User");
    expect(profile.data.email).toBe(mockUser.email);

    // Step 2: Update display name
    const patchReq = new Request("http://localhost:3000/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: "Updated Name" }),
    });
    const patchRes = await PATCH(patchReq);
    expect(patchRes.status).toBe(200);

    // Step 3: Verify update persisted in DB
    expect(db.profiles[0].display_name).toBe("Updated Name");
  });
});

describe("E2E: Chat Conversation Flow", () => {
  let db: MockDB;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDB();
    createE2EClient(db);
    mockChatCompletion.mockResolvedValue(
      mockChatResponse("Hello! How can I help you today?") as never
    );
  });

  it("should complete: send message → create conversation → get response", async () => {
    const { POST } = await import("@/app/api/chat/route");

    // Step 1: Send first message (no conversationId → creates new conversation)
    const chatReq = new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello, what can you do?" }),
    });
    const chatRes = await POST(chatReq);
    const chatBody = await getJsonResponse(chatRes);

    expect(chatRes.status).toBe(200);
    expect(chatBody.conversationId).toBeDefined();
    expect(chatBody.message).toContain("Hello");

    // Step 2: Verify conversation was created in DB
    expect(db.conversations).toHaveLength(1);
    expect(db.conversations[0].tenant_id).toBe(mockProfile.tenant_id);

    // Step 3: Verify messages were stored (user + assistant)
    expect(db.messages).toHaveLength(2);
    expect(db.messages[0].role).toBe("user");
    expect(db.messages[1].role).toBe("assistant");
  });

  it("should handle conversation rename → delete lifecycle", async () => {
    const { PATCH, DELETE } = await import(
      "@/app/api/conversations/[conversationId]/route"
    );

    // Setup: Create a conversation in DB
    const convId = crypto.randomUUID();
    db.conversations.push({
      id: convId,
      tenant_id: mockProfile.tenant_id,
      title: "Original Title",
      created_at: new Date().toISOString(),
    });

    // Step 1: Rename
    const renameReq = new Request(`http://localhost:3000/api/conversations/${convId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Renamed Conversation" }),
    });
    const renameRes = await PATCH(renameReq, {
      params: Promise.resolve({ conversationId: convId }),
    });
    expect(renameRes.status).toBe(200);
    expect(db.conversations[0].title).toBe("Renamed Conversation");

    // Step 2: Delete
    const deleteReq = new Request(`http://localhost:3000/api/conversations/${convId}`, {
      method: "DELETE",
    });
    const deleteRes = await DELETE(deleteReq, {
      params: Promise.resolve({ conversationId: convId }),
    });
    expect(deleteRes.status).toBe(204);
    expect(db.conversations).toHaveLength(0);
  });
});

describe("E2E: Integration Management Flow", () => {
  let db: MockDB;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDB();
    createE2EClient(db);
  });

  it("should complete: create → list (redacted) → update → delete", async () => {
    const { GET, POST, PUT, DELETE } = await import("@/app/api/integrations/route");

    // Step 1: Create integration with API key
    const createReq = new Request("http://localhost:3000/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: "hedy.ai",
        label: "Hedy.ai",
        config: { api_key: "secret-key-12345" },
      }),
    });
    const createRes = await POST(createReq);
    const createBody = await getJsonResponse(createRes);
    expect(createRes.status).toBe(200);

    // Verify POST response redacts secrets
    expect(createBody.data.config.api_key).toBe("••••••••");
    const integrationId = createBody.data.id;

    // Step 2: GET list — verify secrets are redacted
    const listRes = await GET();
    const listBody = await getJsonResponse(listRes);
    expect(listRes.status).toBe(200);
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0].config.api_key).toBe("••••••••");

    // Step 3: Verify actual DB still has real secret
    expect(db.integrations[0].config).toHaveProperty("api_key", "secret-key-12345");

    // Step 4: Update config (add system_prompt)
    const updateReq = new Request("http://localhost:3000/api/integrations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: integrationId,
        config: { system_prompt: "Be helpful" },
      }),
    });
    const updateRes = await PUT(updateReq);
    const updateBody = await getJsonResponse(updateRes);
    expect(updateRes.status).toBe(200);

    // Verify PUT response also redacts secrets
    expect(updateBody.data.config.api_key).toBe("••••••••");
    expect(updateBody.data.config.system_prompt).toBe("Be helpful");

    // Step 5: Delete
    const deleteReq = new Request("http://localhost:3000/api/integrations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: integrationId }),
    });
    const deleteRes = await DELETE(deleteReq);
    expect(deleteRes.status).toBe(200);
    expect(db.integrations).toHaveLength(0);
  });
});

describe("E2E: Hedy.ai Setup Flow", () => {
  let db: MockDB;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDB();
    createE2EClient(db);
    mockGenerateTemplate.mockReturnValue({
      name: "Hedy Webhook",
      nodes: [],
      connections: {},
    } as never);
    mockListWorkflows.mockResolvedValue({ data: [] });
    mockCreateWorkflow.mockResolvedValue(mockN8nWorkflow("wf-hedy") as never);
    mockActivateWorkflow.mockResolvedValue(mockActivatedWorkflow("wf-hedy") as never);
  });

  it("should complete: save key → setup workflow → check status", async () => {
    const { POST: createIntegration } = await import("@/app/api/integrations/route");
    const { GET: getStatus, POST: setupWorkflow } = await import(
      "@/app/api/integrations/hedy/setup/route"
    );

    // Step 1: Save Hedy API key
    const saveReq = new Request("http://localhost:3000/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: "hedy.ai",
        label: "Hedy.ai",
        config: { api_key: "hedy-key-abc" },
      }),
    });
    const saveRes = await createIntegration(saveReq);
    expect(saveRes.status).toBe(200);

    // Step 2: Setup workflow
    const setupRes = await setupWorkflow();
    const setupBody = await getJsonResponse(setupRes);
    expect(setupRes.status).toBe(200);
    expect(setupBody.data.webhookUrl).toContain("hedy-");
    expect(setupBody.data.active).toBe(true);
    expect(mockCreateWorkflow).toHaveBeenCalled();
    expect(mockActivateWorkflow).toHaveBeenCalled();

    // Step 3: Verify n8n workflow was created and activated
    expect(mockCreateWorkflow).toHaveBeenCalled();
    expect(mockActivateWorkflow).toHaveBeenCalledWith("wf-hedy");
  });
});

describe("E2E: Notification Settings Flow", () => {
  let db: MockDB;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDB();
    createE2EClient(db);
  });

  it("should complete: get defaults → save preferences → verify", async () => {
    const { GET, PUT } = await import("@/app/api/notifications/settings/route");

    // Step 1: Get defaults (no settings exist yet)
    const defaultRes = await GET();
    const defaults = await getJsonResponse(defaultRes);
    expect(defaultRes.status).toBe(200);
    expect(defaults.data.enabled).toBe(false);
    expect(defaults.data.frequency).toBe("weekly");

    // Step 2: Save custom settings
    const saveReq = new Request("http://localhost:3000/api/notifications/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        frequency: "daily",
        timezone: "Asia/Tokyo",
      }),
    });
    const saveRes = await PUT(saveReq);
    expect(saveRes.status).toBe(200);

    // Step 3: Verify settings persisted
    expect(db.notification_settings).toHaveLength(1);
    expect(db.notification_settings[0].enabled).toBe(true);
    expect(db.notification_settings[0].frequency).toBe("daily");
    expect(db.notification_settings[0].timezone).toBe("Asia/Tokyo");
  });
});

describe("E2E: Workflow Generation Flow", () => {
  let db: MockDB;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDB();
    createE2EClient(db);
    mockChatCompletion.mockResolvedValue(
      mockChatResponse(
        JSON.stringify({
          name: "Email Notifier",
          description: "Sends email on webhook",
          nodes: [{ type: "n8n-nodes-base.start" }],
          connections: {},
        })
      ) as never
    );
    mockCreateWorkflow.mockResolvedValue(mockN8nWorkflow("wf-gen-1", "Email Notifier") as never);
  });

  it("should complete: generate → validate → create in n8n → save to DB", async () => {
    const { POST } = await import("@/app/api/workflows/generate/route");

    const req = new Request("http://localhost:3000/api/workflows/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Create an email notification workflow" }),
    });
    const res = await POST(req);
    const body = await getJsonResponse(res);

    expect(res.status).toBe(200);
    expect(body.workflow.name).toBe("Email Notifier");
    expect(body.workflow.status).toBe("active");
    expect(body.workflow.n8n_workflow_id).toBe("wf-gen-1");

    // Verify workflow saved to DB (initial insert is "generating",
    // then updated to "active" — mock may not capture the update chain fully,
    // so check the API response instead)
    expect(db.workflows).toHaveLength(1);
    expect(db.workflows[0].tenant_id).toBe(mockProfile.tenant_id);

    // Verify AI was called with system prompt
    expect(mockChatCompletion).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: "system" }),
        expect.objectContaining({ role: "user", content: expect.stringContaining("email") }),
      ]),
      mockUser.id,
      expect.any(Object)
    );
  });
});

// Mock supabaseAdmin for webhook tests
vi.mock("@/lib/supabase/admin", () => {
  const insertedItem = { id: "item-new" };
  return {
    supabaseAdmin: {
      from: vi.fn((table: string) => {
        if (table === "chainthings_profiles") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => ({ data: mockProfile, error: null })),
              })),
            })),
          };
        }
        if (table === "chainthings_items") {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(() => ({ data: insertedItem, error: null })),
              })),
            })),
          };
        }
        return {};
      }),
    },
  };
});

describe("E2E: Webhook Receive Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should receive and store Hedy webhook payload", async () => {
    const { POST } = await import("@/app/api/webhooks/hedy/[tenantId]/route");

    const payload = {
      type: "meeting_note",
      title: "Team Standup",
      content: "Discussed sprint progress",
      metadata: { source: "hedy.ai" },
    };

    const req = new Request(
      `http://localhost:3000/api/webhooks/hedy/${mockProfile.tenant_id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-chainthings-secret": "test-webhook-secret",
        },
        body: JSON.stringify(payload),
      }
    );

    const res = await POST(req, {
      params: Promise.resolve({ tenantId: mockProfile.tenant_id }),
    });
    const body = await getJsonResponse(res);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.id).toBe("item-new");
  });

  it("should reject webhook with invalid secret", async () => {
    const { POST } = await import("@/app/api/webhooks/hedy/[tenantId]/route");

    const req = new Request(
      `http://localhost:3000/api/webhooks/hedy/${mockProfile.tenant_id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-chainthings-secret": "wrong-secret",
        },
        body: JSON.stringify({ title: "Test" }),
      }
    );

    const res = await POST(req, {
      params: Promise.resolve({ tenantId: mockProfile.tenant_id }),
    });
    expect(res.status).toBe(401);
  });
});
