import { describe, it, expect } from "vitest";
import { fixtureTenant, asUser, asAdmin, asAnon, insertOrThrow } from "../helpers/fixtures";

// RLS contract for integration / dev-services data:
//   "Tenant isolation for integrations"    — for all using (tenant_id = chainthings_current_tenant_id())
//   "Tenant isolation for dev_projects"    — for all using (tenant_id = chainthings_current_tenant_id())
//   "Tenant isolation for approval_tokens" — for all using (tenant_id = chainthings_current_tenant_id())
//
// Cross-tenant SELECT / INSERT (spoof) / UPDATE / DELETE must all be blocked.
// Anon must see nothing.
//
// NOTE on chainthings_integrations uniqueness:
//   Migration 022 dropped the original UNIQUE(tenant_id, service) constraint and
//   replaced it with two partial indexes:
//     - UNIQUE(tenant_id, service) WHERE dev_project_id IS NULL   (services without a project)
//     - UNIQUE(tenant_id, dev_project_id, service) WHERE dev_project_id IS NOT NULL
//   Tests fixture only one row per (tenant, service) to stay within this constraint.

// ---------------------------------------------------------------------------
// chainthings_integrations
// ---------------------------------------------------------------------------

describe("RLS: chainthings_integrations", () => {

  it("same-tenant: insert + read own integration works", async () => {
    const t = await fixtureTenant("a");
    const client = asUser(t);

    const { data, error } = await client
      .from("chainthings_integrations")
      .insert({ tenant_id: t.tenantId, service: "test-service", config: {} })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.service).toBe("test-service");
    expect(data?.tenant_id).toBe(t.tenantId);
  });

  it("cross-tenant SELECT: tenant A cannot see tenant B's integrations", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    await insertOrThrow(asUser(b), "chainthings_integrations", {
      tenant_id: b.tenantId,
      service: "svc-b",
      config: {},
    });

    const { data: aSeen } = await asUser(a)
      .from("chainthings_integrations")
      .select("id, service");

    expect(aSeen).toEqual([]);
  });

  it("cross-tenant INSERT: tenant A cannot insert with tenant B's id", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const { data, error } = await asUser(a)
      .from("chainthings_integrations")
      .insert({ tenant_id: b.tenantId, service: "spoofed-svc", config: {} })
      .select();

    // RLS either blocks the insert outright (error) or hides the resulting row.
    expect(error || data?.length === 0).toBeTruthy();
  });

  it("cross-tenant UPDATE: tenant A cannot modify tenant B's integration", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow(asUser(b), "chainthings_integrations", {
      tenant_id: b.tenantId,
      service: "orig-svc",
      config: {},
      label: "original",
    });

    const { data: updated } = await asUser(a)
      .from("chainthings_integrations")
      .update({ label: "hijacked" })
      .eq("id", bRow!.id)
      .select();

    expect(updated).toEqual([]); // RLS filters the row — update is a no-op

    const { data: stillB } = await asAdmin()
      .from("chainthings_integrations")
      .select("label")
      .eq("id", bRow!.id)
      .single();

    expect(stillB?.label).toBe("original");
  });

  it("cross-tenant DELETE: tenant A cannot delete tenant B's integration", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow(asUser(b), "chainthings_integrations", {
      tenant_id: b.tenantId,
      service: "keep-svc",
      config: {},
    });

    await asUser(a)
      .from("chainthings_integrations")
      .delete()
      .eq("id", bRow!.id);

    const { data: stillThere } = await asAdmin()
      .from("chainthings_integrations")
      .select("id")
      .eq("id", bRow!.id);

    expect(stillThere).toHaveLength(1);
  });

  it("anon: cannot read integrations", async () => {
    const t = await fixtureTenant("seed");

    await insertOrThrow(asUser(t), "chainthings_integrations", {
      tenant_id: t.tenantId,
      service: "anon-test-svc",
      config: {},
    });

    const { data } = await asAnon()
      .from("chainthings_integrations")
      .select("id");

    expect(data).toEqual([]);
  });

  it("cross-tenant FK: A cannot insert integration referencing B's dev_project_id", async () => {
    // The strengthened WITH CHECK policy requires:
    //   dev_project_id IS NULL OR EXISTS (... dp.tenant_id = chainthings_current_tenant_id())
    // Since bProject belongs to tenant B, not A, the insert must be blocked.
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bProject = await insertOrThrow<{ id: string }>(
      asAdmin(),
      "chainthings_dev_projects",
      { tenant_id: b.tenantId, name: "B Cross-FK Project" },
    );

    const { data, error } = await asUser(a)
      .from("chainthings_integrations")
      .insert({
        tenant_id: a.tenantId,
        service: "cross-fk-svc",
        config: {},
        dev_project_id: bProject.id,
      })
      .select();

    // The insert must be blocked (error) or the row hidden by RLS (empty data).
    expect(error || data?.length === 0).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// chainthings_dev_projects
// ---------------------------------------------------------------------------

describe("RLS: chainthings_dev_projects", () => {

  it("same-tenant: insert + read own dev project works", async () => {
    const t = await fixtureTenant("a");
    const client = asUser(t);

    const { data, error } = await client
      .from("chainthings_dev_projects")
      .insert({ tenant_id: t.tenantId, name: "Project Alpha" })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.name).toBe("Project Alpha");
    expect(data?.tenant_id).toBe(t.tenantId);
  });

  it("cross-tenant SELECT: tenant A cannot see tenant B's dev projects", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    await insertOrThrow(asUser(b), "chainthings_dev_projects", {
      tenant_id: b.tenantId,
      name: "B's Secret Project",
    });

    const { data: aSeen } = await asUser(a)
      .from("chainthings_dev_projects")
      .select("id, name");

    expect(aSeen).toEqual([]);
  });

  it("cross-tenant INSERT: tenant A cannot insert with tenant B's id", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const { data, error } = await asUser(a)
      .from("chainthings_dev_projects")
      .insert({ tenant_id: b.tenantId, name: "Spoofed Project" })
      .select();

    expect(error || data?.length === 0).toBeTruthy();
  });

  it("cross-tenant UPDATE: tenant A cannot modify tenant B's dev project", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow(asUser(b), "chainthings_dev_projects", {
      tenant_id: b.tenantId,
      name: "Original Name",
    });

    const { data: updated } = await asUser(a)
      .from("chainthings_dev_projects")
      .update({ name: "Hijacked Name" })
      .eq("id", bRow!.id)
      .select();

    expect(updated).toEqual([]);

    const { data: stillB } = await asAdmin()
      .from("chainthings_dev_projects")
      .select("name")
      .eq("id", bRow!.id)
      .single();

    expect(stillB?.name).toBe("Original Name");
  });

  it("cross-tenant DELETE: tenant A cannot delete tenant B's dev project", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow(asUser(b), "chainthings_dev_projects", {
      tenant_id: b.tenantId,
      name: "Keep This Project",
    });

    await asUser(a)
      .from("chainthings_dev_projects")
      .delete()
      .eq("id", bRow!.id);

    const { data: stillThere } = await asAdmin()
      .from("chainthings_dev_projects")
      .select("id")
      .eq("id", bRow!.id);

    expect(stillThere).toHaveLength(1);
  });

  it("anon: cannot read dev projects", async () => {
    const t = await fixtureTenant("seed");

    await insertOrThrow(asUser(t), "chainthings_dev_projects", {
      tenant_id: t.tenantId,
      name: "Anon Test Project",
    });

    const { data } = await asAnon()
      .from("chainthings_dev_projects")
      .select("id");

    expect(data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// chainthings_approval_tokens
// ---------------------------------------------------------------------------
// Columns (migration 024): id, tenant_id, action (NOT NULL), params_hash (NOT NULL),
// expires_at (NOT NULL), consumed_at (nullable), created_at.

describe("RLS: chainthings_approval_tokens", () => {

  const futureExpiry = new Date(Date.now() + 60_000).toISOString();

  it("same-tenant: insert + read own approval token works", async () => {
    const t = await fixtureTenant("a");
    const client = asUser(t);

    const { data, error } = await client
      .from("chainthings_approval_tokens")
      .insert({
        tenant_id: t.tenantId,
        action: "merge_request.close",
        params_hash: "sha256-placeholder-aaa",
        expires_at: futureExpiry,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.action).toBe("merge_request.close");
    expect(data?.tenant_id).toBe(t.tenantId);
  });

  it("cross-tenant SELECT: tenant A cannot see tenant B's approval tokens", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    await insertOrThrow(asUser(b), "chainthings_approval_tokens", {
      tenant_id: b.tenantId,
      action: "issue.delete",
      params_hash: "sha256-placeholder-bbb",
      expires_at: futureExpiry,
    });

    const { data: aSeen } = await asUser(a)
      .from("chainthings_approval_tokens")
      .select("id, action");

    expect(aSeen).toEqual([]);
  });

  it("cross-tenant INSERT: tenant A cannot insert with tenant B's id", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const { data, error } = await asUser(a)
      .from("chainthings_approval_tokens")
      .insert({
        tenant_id: b.tenantId,
        action: "spoofed.action",
        params_hash: "sha256-spoof-ccc",
        expires_at: futureExpiry,
      })
      .select();

    expect(error || data?.length === 0).toBeTruthy();
  });

  it("cross-tenant UPDATE: tenant A cannot consume tenant B's approval token", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow(asUser(b), "chainthings_approval_tokens", {
      tenant_id: b.tenantId,
      action: "pr.merge",
      params_hash: "sha256-placeholder-ddd",
      expires_at: futureExpiry,
    });

    const consumedAt = new Date().toISOString();
    const { data: updated } = await asUser(a)
      .from("chainthings_approval_tokens")
      .update({ consumed_at: consumedAt })
      .eq("id", bRow!.id)
      .select();

    expect(updated).toEqual([]);

    const { data: stillB } = await asAdmin()
      .from("chainthings_approval_tokens")
      .select("consumed_at")
      .eq("id", bRow!.id)
      .single();

    expect(stillB?.consumed_at).toBeNull();
  });

  it("cross-tenant DELETE: tenant A cannot delete tenant B's approval token", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow(asUser(b), "chainthings_approval_tokens", {
      tenant_id: b.tenantId,
      action: "branch.delete",
      params_hash: "sha256-placeholder-eee",
      expires_at: futureExpiry,
    });

    await asUser(a)
      .from("chainthings_approval_tokens")
      .delete()
      .eq("id", bRow!.id);

    const { data: stillThere } = await asAdmin()
      .from("chainthings_approval_tokens")
      .select("id")
      .eq("id", bRow!.id);

    expect(stillThere).toHaveLength(1);
  });

  it("anon: cannot read approval tokens", async () => {
    const t = await fixtureTenant("seed");

    await insertOrThrow(asUser(t), "chainthings_approval_tokens", {
      tenant_id: t.tenantId,
      action: "anon.test",
      params_hash: "sha256-anon-fff",
      expires_at: futureExpiry,
    });

    const { data } = await asAnon()
      .from("chainthings_approval_tokens")
      .select("id");

    expect(data).toEqual([]);
  });
});
