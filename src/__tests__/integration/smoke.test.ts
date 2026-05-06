import { describe, it, expect } from "vitest";
import { fixtureTenant, asUser, asAdmin } from "./helpers/fixtures";

// Smoke test — exercises the whole plumbing chain:
//   1. asAdmin() reaches the test stack
//   2. fixtureTenant() creates an auth user, the on_auth_user_created trigger
//      auto-inserts a chainthings_profiles row, and the JWT signin works
//   3. asUser() with that JWT can read chainthings_profiles via RLS
//
// If this passes, every RLS test below it has working infrastructure.

describe("integration smoke", () => {
  it("admin client reaches the stack", async () => {
    const { error } = await asAdmin().from("chainthings_profiles").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("fixtureTenant creates user + profile + JWT, RLS-restricted to own row", async () => {
    const tenant = await fixtureTenant("smoke");

    expect(tenant.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(tenant.tenantId).toMatch(/^[0-9a-f-]{36}$/);
    expect(tenant.jwt.length).toBeGreaterThan(20);

    // RLS: user sees their own profile
    const { data, error } = await asUser(tenant)
      .from("chainthings_profiles")
      .select("id, tenant_id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      id: tenant.userId,
      tenant_id: tenant.tenantId,
    });
  });

  it("two tenants get distinct tenant_ids and cannot see each other", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    expect(a.tenantId).not.toBe(b.tenantId);

    // A's client only returns A's profile, never B's
    const { data: aSeen } = await asUser(a)
      .from("chainthings_profiles")
      .select("id");
    expect(aSeen).toHaveLength(1);
    expect(aSeen?.[0].id).toBe(a.userId);
  });
});
