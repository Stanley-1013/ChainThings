import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { getStackConfig } from "./stack-config";

// Test fixture helpers for RLS integration tests.
//
// Flow per fixtureTenant():
//   1. Service-role client calls auth.admin.createUser (email_confirm=true
//      so the user can sign in immediately, no inbucket required).
//   2. Trigger `on_auth_user_created` (migration 001) auto-inserts a row
//      in chainthings_profiles with a random tenant_id (gen_random_uuid).
//   3. signInWithPassword on a fresh anon client to get a real JWT.
//      Real GoTrue JWTs are required because RLS policies inspect
//      auth.uid() and auth.jwt() — self-signing would need duplicating
//      every claim and getting subtle things like aud / exp right.
//   4. Read the trigger-generated tenant_id back from profiles.

export interface TestTenant {
  userId: string;
  email: string;
  password: string;
  jwt: string;
  tenantId: string;
}

const TEST_PASSWORD = "test-password-1234567890";
const TEST_EMAIL_DOMAIN = "test.local";

export function fakeVector1024(seed = 0.01): number[] {
  return Array.from({ length: 1024 }, () => seed);
}

let cachedAdmin: SupabaseClient | null = null;
export function asAdmin(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  const cfg = getStackConfig();
  cachedAdmin = createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedAdmin;
}

export function asUser(tenant: TestTenant): SupabaseClient {
  const cfg = getStackConfig();
  return createClient(cfg.url, cfg.anonKey, {
    global: {
      headers: { Authorization: `Bearer ${tenant.jwt}` },
    },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// asAnon() — for testing public-policy paths (no JWT, no service-role).
// Equivalent to a logged-out user.
export function asAnon(): SupabaseClient {
  const cfg = getStackConfig();
  return createClient(cfg.url, cfg.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function fixtureTenant(
  label = "tenant",
): Promise<TestTenant> {
  const admin = asAdmin();
  const email = `${label}-${randomUUID()}@${TEST_EMAIL_DOMAIN}`;

  const { data: created, error: createErr } =
    await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });

  if (createErr || !created.user) {
    throw new Error(
      `fixtureTenant: createUser failed: ${createErr?.message ?? "no user returned"}`,
    );
  }
  const userId = created.user.id;

  // The on_auth_user_created trigger inserts chainthings_profiles in the
  // same transaction as the auth.users INSERT. After createUser returns the
  // commit should be visible — but under load we occasionally see a brief
  // visibility/replication window. Retry the profile lookup a few times
  // before giving up.
  let profile: { tenant_id: string } | null = null;
  let profileErr: { message: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 100 * attempt));
    const res = await admin
      .from("chainthings_profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (res.data) {
      profile = res.data;
      break;
    }
    profileErr = res.error;
  }

  if (!profile) {
    throw new Error(
      `fixtureTenant: profile lookup failed for user ${userId} after retries: ${profileErr?.message ?? "no row"}`,
    );
  }

  // Sign in to get a JWT that carries the role=authenticated claim and the
  // user's sub. RLS policies need this. Retry once on the GoTrue
  // prepared-statement / sessions-FK transient — it's a known issue under
  // high createUser/deleteUser churn (see docs/ops/integration-tests.md).
  const cfg = getStackConfig();
  const signInClient = createClient(cfg.url, cfg.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let session: { access_token: string } | null = null;
  let signInErrMsg: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250));
    const { data, error: err } = await signInClient.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    if (data.session) {
      session = data.session;
      break;
    }
    signInErrMsg = err?.message ?? "no session";
    // Only retry on the known transient class
    if (
      !/granting user|prepared statement|transaction is aborted|Database error/i.test(
        signInErrMsg,
      )
    ) {
      break;
    }
  }

  if (!session) {
    throw new Error(
      `fixtureTenant: signIn failed for ${email} (userId=${userId}): ${signInErrMsg}`,
    );
  }

  return {
    userId,
    email,
    password: TEST_PASSWORD,
    jwt: session.access_token,
    tenantId: profile.tenant_id,
  };
}

// insertOrThrow — for cross-tenant seeds. The cross-tenant assertion pattern
// is "tenant A creates a row, tenant B can't see it". If the *seed* insert
// silently fails (RLS policy drift, schema change, FK violation), the
// follow-up assertion would still pass with `[]` — a false-positive RLS
// pass. Wrap every seed with this helper to crash loudly instead.
//
// Returns the inserted row's id (assumes the row has an `id` column, which
// is true for every chainthings_* table).
export async function insertOrThrow<T extends { id: string }>(
  client: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client
    .from(table)
    .insert(row)
    .select()
    .single<T>();
  if (error || !data) {
    throw new Error(
      `insertOrThrow: ${table} insert failed (${error?.code ?? "?"}): ${error?.message ?? "no row"}`,
    );
  }
  return data;
}
