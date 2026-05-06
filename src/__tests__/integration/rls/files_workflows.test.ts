import { describe, it, expect } from "vitest";
import { fixtureTenant, asUser, asAdmin, asAnon, insertOrThrow } from "../helpers/fixtures";

// RLS contract for file/workflow data:
//   policy "Tenant isolation for files"               — for all using (tenant_id = chainthings_current_tenant_id())
//   policy "Tenant isolation for workflows"           — for all using (tenant_id = chainthings_current_tenant_id())
//   policy "Tenant isolation for workflow_executions" — for all using (tenant_id = chainthings_current_tenant_id())
// Cross-tenant SELECT/UPDATE/DELETE/INSERT must be blocked. Anon must see nothing.

// ---------------------------------------------------------------------------
// chainthings_files
// ---------------------------------------------------------------------------
describe("RLS: chainthings_files", () => {

  it("same-tenant: insert + read own file works", async () => {
    const t = await fixtureTenant("a");
    const client = asUser(t);

    const { data, error } = await client
      .from("chainthings_files")
      .insert({
        tenant_id: t.tenantId,
        filename: "report.pdf",
        storage_path: "tenants/a/report.pdf",
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.filename).toBe("report.pdf");
    expect(data?.tenant_id).toBe(t.tenantId);
  });

  it("cross-tenant SELECT: tenant A cannot see tenant B's files", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    await insertOrThrow(asUser(b), "chainthings_files", {
      tenant_id: b.tenantId,
      filename: "secret.pdf",
      storage_path: "tenants/b/secret.pdf",
    });

    const { data: aSeen } = await asUser(a)
      .from("chainthings_files")
      .select("id, filename");

    expect(aSeen).toEqual([]);
  });

  it("cross-tenant INSERT: tenant A cannot insert with tenant B's id", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const { data, error } = await asUser(a)
      .from("chainthings_files")
      .insert({
        tenant_id: b.tenantId,
        filename: "spoofed.pdf",
        storage_path: "tenants/b/spoofed.pdf",
      })
      .select();

    // RLS WITH CHECK rejects the insert or returns 0 rows
    expect(error || data?.length === 0).toBeTruthy();
  });

  it("cross-tenant UPDATE: tenant A cannot modify tenant B's file row", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow(asUser(b), "chainthings_files", {
      tenant_id: b.tenantId,
      filename: "original.pdf",
      storage_path: "tenants/b/original.pdf",
    });

    const { data: updated } = await asUser(a)
      .from("chainthings_files")
      .update({ filename: "hijacked.pdf" })
      .eq("id", bRow.id)
      .select();

    expect(updated).toEqual([]); // RLS filtered the row out — update is a no-op

    // Verify B's row is unchanged via admin
    const { data: stillB } = await asAdmin()
      .from("chainthings_files")
      .select("filename")
      .eq("id", bRow.id)
      .single();

    expect(stillB?.filename).toBe("original.pdf");
  });

  it("cross-tenant DELETE: tenant A cannot delete tenant B's file row", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow(asUser(b), "chainthings_files", {
      tenant_id: b.tenantId,
      filename: "keep-me.pdf",
      storage_path: "tenants/b/keep-me.pdf",
    });

    await asUser(a).from("chainthings_files").delete().eq("id", bRow.id);

    const { data: stillThere } = await asAdmin()
      .from("chainthings_files")
      .select("id")
      .eq("id", bRow.id);

    expect(stillThere).toHaveLength(1);
  });

  it("anon: cannot read any files", async () => {
    const t = await fixtureTenant("seed");

    await insertOrThrow(asUser(t), "chainthings_files", {
      tenant_id: t.tenantId,
      filename: "visible.pdf",
      storage_path: "tenants/seed/visible.pdf",
    });

    const { data: rows } = await asAnon().from("chainthings_files").select("id");
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// chainthings_workflows
// ---------------------------------------------------------------------------
describe("RLS: chainthings_workflows", () => {

  it("same-tenant: insert + read own workflow works", async () => {
    const t = await fixtureTenant("a");
    const client = asUser(t);

    const { data, error } = await client
      .from("chainthings_workflows")
      .insert({
        tenant_id: t.tenantId,
        name: "My Workflow",
        status: "pending",
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.name).toBe("My Workflow");
    expect(data?.tenant_id).toBe(t.tenantId);
  });

  it("cross-tenant SELECT: tenant A cannot see tenant B's workflows", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    await insertOrThrow(asUser(b), "chainthings_workflows", {
      tenant_id: b.tenantId,
      name: "B's Workflow",
      status: "active",
    });

    const { data: aSeen } = await asUser(a)
      .from("chainthings_workflows")
      .select("id, name");

    expect(aSeen).toEqual([]);
  });

  it("cross-tenant INSERT: tenant A cannot insert with tenant B's id", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const { data, error } = await asUser(a)
      .from("chainthings_workflows")
      .insert({
        tenant_id: b.tenantId,
        name: "spoofed workflow",
        status: "pending",
      })
      .select();

    // RLS WITH CHECK rejects the insert or returns 0 rows
    expect(error || data?.length === 0).toBeTruthy();
  });

  it("cross-tenant UPDATE: tenant A cannot modify tenant B's workflow", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow(asUser(b), "chainthings_workflows", {
      tenant_id: b.tenantId,
      name: "original name",
      status: "pending",
    });

    const { data: updated } = await asUser(a)
      .from("chainthings_workflows")
      .update({ name: "hijacked name" })
      .eq("id", bRow.id)
      .select();

    expect(updated).toEqual([]); // RLS filtered the row out — update is a no-op

    // Verify B's row is unchanged via admin
    const { data: stillB } = await asAdmin()
      .from("chainthings_workflows")
      .select("name")
      .eq("id", bRow.id)
      .single();

    expect(stillB?.name).toBe("original name");
  });

  it("cross-tenant DELETE: tenant A cannot delete tenant B's workflow", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow(asUser(b), "chainthings_workflows", {
      tenant_id: b.tenantId,
      name: "keep me",
      status: "pending",
    });

    await asUser(a).from("chainthings_workflows").delete().eq("id", bRow.id);

    const { data: stillThere } = await asAdmin()
      .from("chainthings_workflows")
      .select("id")
      .eq("id", bRow.id);

    expect(stillThere).toHaveLength(1);
  });

  it("anon: cannot read any workflows", async () => {
    const t = await fixtureTenant("seed");

    await insertOrThrow(asUser(t), "chainthings_workflows", {
      tenant_id: t.tenantId,
      name: "Seed Workflow",
      status: "pending",
    });

    const { data: rows } = await asAnon().from("chainthings_workflows").select("id");
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// chainthings_workflow_executions
// ---------------------------------------------------------------------------
describe("RLS: chainthings_workflow_executions", () => {

  it("same-tenant: insert + read own execution works", async () => {
    const t = await fixtureTenant("a");
    const client = asUser(t);

    const { data, error } = await client
      .from("chainthings_workflow_executions")
      .insert({
        tenant_id: t.tenantId,
        workflow_name: "send-email",
        input_params: { to: "user@example.com" },
        status: "running",
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.workflow_name).toBe("send-email");
    expect(data?.tenant_id).toBe(t.tenantId);
  });

  it("cross-tenant SELECT: tenant A cannot see tenant B's executions", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    await insertOrThrow(asUser(b), "chainthings_workflow_executions", {
      tenant_id: b.tenantId,
      workflow_name: "b-secret-flow",
      input_params: {},
      status: "completed",
    });

    const { data: aSeen } = await asUser(a)
      .from("chainthings_workflow_executions")
      .select("id, workflow_name");

    expect(aSeen).toEqual([]);
  });

  it("cross-tenant INSERT: tenant A cannot insert with tenant B's id", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const { data, error } = await asUser(a)
      .from("chainthings_workflow_executions")
      .insert({
        tenant_id: b.tenantId,
        workflow_name: "spoofed-flow",
        input_params: {},
        status: "running",
      })
      .select();

    // RLS WITH CHECK rejects the insert or returns 0 rows
    expect(error || data?.length === 0).toBeTruthy();
  });

  it("cross-tenant UPDATE: tenant A cannot modify tenant B's execution", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow(asUser(b), "chainthings_workflow_executions", {
      tenant_id: b.tenantId,
      workflow_name: "original-flow",
      input_params: {},
      status: "running",
    });

    const { data: updated } = await asUser(a)
      .from("chainthings_workflow_executions")
      .update({ status: "failed" })
      .eq("id", bRow.id)
      .select();

    expect(updated).toEqual([]); // RLS filtered the row out — update is a no-op

    // Verify B's row is unchanged via admin
    const { data: stillB } = await asAdmin()
      .from("chainthings_workflow_executions")
      .select("status")
      .eq("id", bRow.id)
      .single();

    expect(stillB?.status).toBe("running");
  });

  it("cross-tenant DELETE: tenant A cannot delete tenant B's execution", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow(asUser(b), "chainthings_workflow_executions", {
      tenant_id: b.tenantId,
      workflow_name: "keep-me-flow",
      input_params: {},
      status: "completed",
    });

    await asUser(a)
      .from("chainthings_workflow_executions")
      .delete()
      .eq("id", bRow.id);

    const { data: stillThere } = await asAdmin()
      .from("chainthings_workflow_executions")
      .select("id")
      .eq("id", bRow.id);

    expect(stillThere).toHaveLength(1);
  });

  it("anon: cannot read any workflow executions", async () => {
    const t = await fixtureTenant("seed");

    await insertOrThrow(asUser(t), "chainthings_workflow_executions", {
      tenant_id: t.tenantId,
      workflow_name: "seed-flow",
      input_params: {},
      status: "running",
    });

    const { data: rows } = await asAnon()
      .from("chainthings_workflow_executions")
      .select("id");

    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// RLS: workflow_executions — parent-child FK isolation
// ---------------------------------------------------------------------------
describe("RLS: workflow_executions — parent-child FK isolation", () => {

  it("cross-tenant FK: A cannot insert execution referencing B's dev_project_id", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    // B creates a dev_project in its own tenant
    const bDevProject = await insertOrThrow(asUser(b), "chainthings_dev_projects", {
      tenant_id: b.tenantId,
      name: "B's Dev Project",
    });

    // Attack: A inserts an execution with its own tenant_id but B's dev_project_id.
    // The strengthened WITH CHECK policy now requires:
    //   dev_project_id IS NULL OR EXISTS (... dp.tenant_id = chainthings_current_tenant_id())
    // Since bDevProject belongs to tenant B, not A, the insert must be blocked.
    const { data, error } = await asUser(a)
      .from("chainthings_workflow_executions")
      .insert({
        tenant_id: a.tenantId,
        dev_project_id: bDevProject.id, // FK to B's row — now blocked by WITH CHECK
        workflow_name: "fk-spoof-flow",
        input_params: {},
        status: "running",
      })
      .select();

    // The insert must be blocked (error) or the row hidden by RLS (empty data).
    expect(error || data?.length === 0).toBeTruthy();
  });
});
