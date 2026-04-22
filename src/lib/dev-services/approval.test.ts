import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

// ── Supabase admin mock ──────────────────────────────────────────────────────
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockIs = vi.fn();
const mockGt = vi.fn();
const mockMaybeSingle = vi.fn();
const mockSelectAfterUpdate = vi.fn();
const mockEqChain = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { supabaseAdmin } from "@/lib/supabase/admin";
import { hashParams, generateApprovalToken, consumeApprovalToken } from "./approval";

const mockFrom = vi.mocked(supabaseAdmin.from);

// Helpers to build mock chain for insert
function setupInsert(returnData: unknown, returnError: unknown = null) {
  const single = vi.fn(() => ({ data: returnData, error: returnError }));
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  mockFrom.mockReturnValue({ insert } as never);
}

// Helpers to build mock chain for update…select…maybeSingle
function setupConsumeUpdate(returnData: unknown, returnError: unknown = null) {
  const maybeSingle = vi.fn(() => ({ data: returnData, error: returnError }));
  const select = vi.fn(() => ({ maybeSingle }));
  const gt = vi.fn(() => ({ select }));
  const is = vi.fn(() => ({ gt }));
  const eq = vi.fn(() => ({ is }));
  const update = vi.fn(() => ({ eq }));
  mockFrom.mockReturnValue({ update } as never);
}

beforeAll(() => {
  // Ensure the secret meets the ≥32-char requirement
  process.env.CHAINTHINGS_WEBHOOK_SECRET =
    "test-webhook-secret-that-is-long-enough-for-hmac";
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hashParams", () => {
  it("produces the same hash regardless of key order (canonical JSON)", () => {
    const h1 = hashParams({ a: 1, b: 2 });
    const h2 = hashParams({ b: 2, a: 1 });
    expect(h1).toBe(h2);
  });

  it("produces different hashes for different params", () => {
    expect(hashParams({ a: 1 })).not.toBe(hashParams({ a: 2 }));
  });
});

describe("generateApprovalToken", () => {
  it("inserts a DB row and returns a token in uuid.hex format", async () => {
    const fakeId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    setupInsert({ id: fakeId });

    const token = await generateApprovalToken("tenant-1", "approve_action", { x: 1 });

    expect(mockFrom).toHaveBeenCalledWith("chainthings_approval_tokens");
    // Token format: <uuid>.<hex>
    const [tokenId, sig] = token.split(".");
    expect(tokenId).toBe(fakeId);
    expect(/^[0-9a-f]+$/.test(sig)).toBe(true);
  });

  it("throws when the DB insert fails", async () => {
    setupInsert(null, { message: "unique violation" });
    await expect(
      generateApprovalToken("tenant-1", "approve_action", {}),
    ).rejects.toThrow(/Failed to issue approval token/);
  });
});

describe("consumeApprovalToken", () => {
  const SECRET =
    "test-webhook-secret-that-is-long-enough-for-hmac";
  const TENANT_ID = "tenant-1";
  const ACTION = "do_thing";
  const PARAMS = { key: "value" };

  function validToken(id: string): string {
    const sig = createHmac("sha256", SECRET).update(id).digest("hex");
    return `${id}.${sig}`;
  }

  it("returns null when token format is malformed (no dot separator)", async () => {
    const result = await consumeApprovalToken(
      "nodot",
      TENANT_ID,
      ACTION,
      PARAMS,
    );
    expect(result).toBeNull();
  });

  it("returns null when HMAC signature does not match", async () => {
    const id = "some-uuid";
    const token = `${id}.badsignaturebadsignaturebadsignaturebadsignaturebadsignaturebadsig`;
    const result = await consumeApprovalToken(token, TENANT_ID, ACTION, PARAMS);
    expect(result).toBeNull();
  });

  it("returns null when CAS update returns empty (token already consumed or expired)", async () => {
    setupConsumeUpdate(null, null);
    const token = validToken("uuid-1234");
    const result = await consumeApprovalToken(token, TENANT_ID, ACTION, PARAMS);
    expect(result).toBeNull();
  });

  it("returns null when tenantId in DB row does not match expectedTenantId", async () => {
    const id = "uuid-2345";
    setupConsumeUpdate({
      id,
      tenant_id: "other-tenant",
      action: ACTION,
      params_hash: hashParams(PARAMS),
    });
    const result = await consumeApprovalToken(
      validToken(id),
      TENANT_ID,
      ACTION,
      PARAMS,
    );
    expect(result).toBeNull();
  });

  it("returns null when params hash does not match (attacker swapped params)", async () => {
    const id = "uuid-3456";
    setupConsumeUpdate({
      id,
      tenant_id: TENANT_ID,
      action: ACTION,
      params_hash: hashParams({ different: "params" }),
    });
    const result = await consumeApprovalToken(
      validToken(id),
      TENANT_ID,
      ACTION,
      PARAMS, // real params don't match stored hash
    );
    expect(result).toBeNull();
  });

  it("returns VerifiedApproval when all checks pass", async () => {
    const id = "uuid-good";
    const paramsHash = hashParams(PARAMS);
    setupConsumeUpdate({
      id,
      tenant_id: TENANT_ID,
      action: ACTION,
      params_hash: paramsHash,
    });

    const result = await consumeApprovalToken(
      validToken(id),
      TENANT_ID,
      ACTION,
      PARAMS,
    );

    expect(result).not.toBeNull();
    expect(result?.tokenId).toBe(id);
    expect(result?.tenantId).toBe(TENANT_ID);
    expect(result?.action).toBe(ACTION);
    expect(result?.paramsHash).toBe(paramsHash);
  });
});
