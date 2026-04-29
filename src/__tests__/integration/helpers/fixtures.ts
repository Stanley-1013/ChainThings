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

  // Trigger fires synchronously in the same transaction that committed
  // auth.users insert, so by the time createUser returns, the profile
  // row should already exist. But add a 50ms safety net for edge cases.
  await new Promise((r) => setTimeout(r, 50));

  const { data: profile, error: profileErr } = await admin
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", userId)
    .single();

  if (profileErr || !profile) {
    throw new Error(
      `fixtureTenant: profile lookup failed for user ${userId}: ${profileErr?.message ?? "no row"}`,
    );
  }

  // Sign in to get a JWT that carries the role=authenticated claim
  // and the user's sub. RLS policies need this.
  const cfg = getStackConfig();
  const signInClient = createClient(cfg.url, cfg.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: session, error: signInErr } =
    await signInClient.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });

  if (signInErr || !session.session) {
    throw new Error(
      `fixtureTenant: signIn failed for ${email}: ${signInErr?.message ?? "no session"}`,
    );
  }

  return {
    userId,
    email,
    password: TEST_PASSWORD,
    jwt: session.session.access_token,
    tenantId: profile.tenant_id,
  };
}
