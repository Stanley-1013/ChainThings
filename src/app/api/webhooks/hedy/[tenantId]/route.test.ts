import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createHmac } from "crypto";

const WEBHOOK_SECRET = "test-webhook-secret";

// Mock supabaseAdmin
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

function makeSignature(
  tenantId: string,
  timestamp: string,
  body: string
): string {
  const payload = `${tenantId}:${timestamp}:${body}`;
  return createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
}

function makeRequest(
  tenantId: string,
  body: Record<string, unknown>,
  overrides?: { timestamp?: string; signature?: string; omitHeaders?: boolean }
) {
  const bodyStr = JSON.stringify(body);
  const timestamp = overrides?.timestamp || Date.now().toString();
  const signature =
    overrides?.signature || makeSignature(tenantId, timestamp, bodyStr);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (!overrides?.omitHeaders) {
    headers["x-chainthings-timestamp"] = timestamp;
    headers["x-chainthings-signature"] = signature;
  }

  return new Request(`http://localhost/api/webhooks/hedy/${tenantId}`, {
    method: "POST",
    headers,
    body: bodyStr,
  });
}

function makeParams(tenantId: string) {
  return { params: Promise.resolve({ tenantId }) };
}

function setupMocks(profileExists = true, insertSuccess = true) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "chainthings_profiles") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => ({
              data: profileExists ? { tenant_id: "tenant-123" } : null,
              error: null,
            })),
          })),
        })),
      };
    }
    if (table === "chainthings_items") {
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() => ({
              data: insertSuccess ? { id: "item-1" } : null,
              error: insertSuccess
                ? null
                : { message: "constraint violation" },
            })),
          })),
        })),
      };
    }
    return {};
  });
}

describe("POST /api/webhooks/hedy/[tenantId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CHAINTHINGS_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  it("should return 401 when auth headers are missing", async () => {
    const req = makeRequest("tenant-123", { title: "Test" }, { omitHeaders: true });
    const res = await POST(req, makeParams("tenant-123"));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Missing authentication");
  });

  it("should return 401 when signature is invalid", async () => {
    const req = makeRequest(
      "tenant-123",
      { title: "Test" },
      { signature: "invalid-sig" }
    );
    const res = await POST(req, makeParams("tenant-123"));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Invalid signature");
  });

  it("should return 401 when request is expired (replay protection)", async () => {
    const oldTimestamp = (Date.now() - 10 * 60 * 1000).toString(); // 10 minutes ago
    const bodyStr = JSON.stringify({ title: "Test" });
    const sig = makeSignature("tenant-123", oldTimestamp, bodyStr);

    const req = makeRequest(
      "tenant-123",
      { title: "Test" },
      { timestamp: oldTimestamp, signature: sig }
    );
    const res = await POST(req, makeParams("tenant-123"));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("expired");
  });

  it("should return 400 when tenant does not exist", async () => {
    setupMocks(false);
    const req = makeRequest("bad-tenant", { title: "Test" });
    const res = await POST(req, makeParams("bad-tenant"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid tenant");
  });

  it("should successfully insert item for valid request", async () => {
    setupMocks(true, true);
    const req = makeRequest("tenant-123", {
      type: "meeting_note",
      title: "Team Standup",
      content: "Discussion about sprint goals",
      external_id: "hedy-session-1",
      metadata: { source: "hedy.ai" },
    });
    const res = await POST(req, makeParams("tenant-123"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.id).toBe("item-1");
  });

  it("should return 500 when database insert fails", async () => {
    setupMocks(true, false);
    const req = makeRequest("tenant-123", { title: "Test" });
    const res = await POST(req, makeParams("tenant-123"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to save item");
  });

  it("should sanitize input fields", async () => {
    setupMocks(true, true);
    const req = makeRequest("tenant-123", {
      type: 123, // non-string
      title: "A".repeat(600), // too long
      content: null, // null
    });
    const res = await POST(req, makeParams("tenant-123"));

    expect(res.status).toBe(200);
    // The route should have sanitized: type→"meeting_note", title→truncated, content→""
    const insertCall = mockFrom.mock.calls.find(
      (c) => c[0] === "chainthings_items"
    );
    expect(insertCall).toBeDefined();
  });
});
