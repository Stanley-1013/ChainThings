import { createHash, createHmac } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getSecret(): string {
  const s = process.env.CHAINTHINGS_WEBHOOK_SECRET;
  if (!s || s.length < 32) {
    throw new Error("CHAINTHINGS_WEBHOOK_SECRET is required (min 32 chars)");
  }
  return s;
}

export function hashParams(params: unknown): string {
  // Canonical JSON: sort keys so {a:1,b:2} and {b:2,a:1} hash the same
  return createHash("sha256").update(canonicalJson(params)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") + "}";
}

export async function generateApprovalToken(
  tenantId: string,
  action: string,
  params: unknown,
): Promise<string> {
  const paramsHash = hashParams(params);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  const { data, error } = await supabaseAdmin
    .from("chainthings_approval_tokens")
    .insert({
      tenant_id: tenantId,
      action,
      params_hash: paramsHash,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Failed to issue approval token: ${error?.message ?? "unknown"}`);

  // Opaque token = signed compact: id.sig
  const sig = createHmac("sha256", getSecret()).update(data.id).digest("hex");
  return `${data.id}.${sig}`;
}

export interface VerifiedApproval {
  tokenId: string;
  tenantId: string;
  action: string;
  paramsHash: string;
}

/**
 * Verify + consume token in a single CAS-safe DB step.
 * Returns null if invalid/expired/consumed/params-mismatch.
 */
export async function consumeApprovalToken(
  token: string,
  expectedTenantId: string,
  expectedAction: string,
  actualParams: unknown,
): Promise<VerifiedApproval | null> {
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const tokenId = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  // Verify HMAC first (cheap — avoids unnecessary DB round-trip)
  const expected = createHmac("sha256", getSecret()).update(tokenId).digest("hex");
  if (sig.length !== expected.length) return null;
  // Timing-safe compare (avoids leaking via early exit)
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;

  // CAS consume: UPDATE WHERE consumed_at IS NULL AND expires_at > now()
  // This is atomic in Postgres — concurrent replicas cannot both succeed.
  const { data, error } = await supabaseAdmin
    .from("chainthings_approval_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", tokenId)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id, tenant_id, action, params_hash")
    .maybeSingle();

  if (error || !data) return null;

  // Verify tenant + action + params_hash match what caller is actually doing
  if (data.tenant_id !== expectedTenantId) return null;
  if (data.action !== expectedAction) return null;
  const actualHash = hashParams(actualParams);
  if (actualHash !== data.params_hash) {
    // Token was issued for a different params payload — reject.
    // Intentionally already consumed: prevents brute-force param swapping.
    return null;
  }

  return {
    tokenId: data.id,
    tenantId: data.tenant_id,
    action: data.action,
    paramsHash: data.params_hash,
  };
}
