import { describe, it, expect } from "vitest";
import { fixtureTenant, asUser, asAdmin, asAnon, insertOrThrow } from "../helpers/fixtures";

// RLS contract for task-center data:
//   policy "Tenant isolation for items"                — for all using (tenant_id = chainthings_current_tenant_id())
//   policy "Tenant isolation for memory_entries"       — for all using (tenant_id = chainthings_current_tenant_id())
//   policy "Tenant isolation for notification_settings"— for all using (tenant_id = chainthings_current_tenant_id())
//   policy "Tenant isolation for notification_cache"   — for all using (tenant_id = chainthings_current_tenant_id())
// Cross-tenant SELECT/UPDATE/DELETE/INSERT must be blocked. Anon must see nothing.

// ---------------------------------------------------------------------------
// chainthings_items
// ---------------------------------------------------------------------------
describe("RLS: chainthings_items", () => {

  it("same-tenant: insert + read own item works", async () => {
    const t = await fixtureTenant("a");
    const client = asUser(t);

    const { data, error } = await client
      .from("chainthings_items")
      .insert({ tenant_id: t.tenantId, type: "note", title: "my item", content: "hello" })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.title).toBe("my item");
    expect(data?.tenant_id).toBe(t.tenantId);
  });

  it("cross-tenant SELECT: tenant A cannot see tenant B's items", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    await insertOrThrow(asUser(b), "chainthings_items", {
      tenant_id: b.tenantId,
      type: "note",
      title: "B's item",
    });

    const { data: aSeen } = await asUser(a)
      .from("chainthings_items")
      .select("id, title");

    expect(aSeen).toEqual([]);
  });

  it("cross-tenant INSERT: tenant A cannot insert with tenant B's id", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const { data, error } = await asUser(a)
      .from("chainthings_items")
      .insert({ tenant_id: b.tenantId, type: "note", title: "spoof" })
      .select();

    // Either the insert is blocked (error) or RLS hides the row (empty data).
    // Either is a valid pass. The bad case is `data` containing a row visible
    // outside tenant A's scope.
    expect(error || data?.length === 0).toBeTruthy();
  });

  it("cross-tenant UPDATE: tenant A cannot modify tenant B's item", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow<{ id: string; title: string }>(
      asUser(b),
      "chainthings_items",
      { tenant_id: b.tenantId, type: "note", title: "original" },
    );

    const { data: updated } = await asUser(a)
      .from("chainthings_items")
      .update({ title: "hijacked" })
      .eq("id", bRow.id)
      .select();

    expect(updated).toEqual([]); // RLS filtered the row out — update is a no-op

    // Verify B's row is unchanged
    const { data: stillB } = await asAdmin()
      .from("chainthings_items")
      .select("title")
      .eq("id", bRow.id)
      .single();

    expect(stillB?.title).toBe("original");
  });

  it("cross-tenant DELETE: tenant A cannot delete tenant B's item", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow<{ id: string }>(
      asUser(b),
      "chainthings_items",
      { tenant_id: b.tenantId, type: "note", title: "keep me" },
    );

    await asUser(a).from("chainthings_items").delete().eq("id", bRow.id);

    const { data: stillThere } = await asAdmin()
      .from("chainthings_items")
      .select("id")
      .eq("id", bRow.id);

    expect(stillThere).toHaveLength(1);
  });

  it("anon: cannot read items", async () => {
    const t = await fixtureTenant("seed");

    await insertOrThrow(asUser(t), "chainthings_items", {
      tenant_id: t.tenantId,
      type: "note",
      title: "secret",
    });

    const { data } = await asAnon().from("chainthings_items").select("id");
    expect(data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// chainthings_memory_entries
// Note: inserting an active memory entry fires the chainthings_queue_memory_embedding
// trigger which creates a row in chainthings_rag_documents. That side-effect is
// benign — the tests below only verify RLS on the memory entry itself.
// ---------------------------------------------------------------------------
describe("RLS: chainthings_memory_entries", () => {

  it("same-tenant: insert + read own memory entry works", async () => {
    const t = await fixtureTenant("a");
    const client = asUser(t);

    const { data, error } = await client
      .from("chainthings_memory_entries")
      .insert({ tenant_id: t.tenantId, category: "task", content: "finish the report" })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.content).toBe("finish the report");
    expect(data?.tenant_id).toBe(t.tenantId);
  });

  it("cross-tenant SELECT: tenant A cannot see tenant B's memory entries", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    await insertOrThrow(asUser(b), "chainthings_memory_entries", {
      tenant_id: b.tenantId,
      category: "task",
      content: "B's secret task",
    });

    const { data: aSeen } = await asUser(a)
      .from("chainthings_memory_entries")
      .select("id, content");

    expect(aSeen).toEqual([]);
  });

  it("cross-tenant INSERT: tenant A cannot insert with tenant B's id", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const { data, error } = await asUser(a)
      .from("chainthings_memory_entries")
      .insert({ tenant_id: b.tenantId, category: "task", content: "spoof memory" })
      .select();

    // Either the insert is blocked (error) or RLS hides the row (empty data).
    expect(error || data?.length === 0).toBeTruthy();
  });

  it("cross-tenant UPDATE: tenant A cannot modify tenant B's memory entry", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow<{ id: string; content: string }>(
      asUser(b),
      "chainthings_memory_entries",
      { tenant_id: b.tenantId, category: "fact", content: "original fact" },
    );

    const { data: updated } = await asUser(a)
      .from("chainthings_memory_entries")
      .update({ content: "hijacked fact" })
      .eq("id", bRow.id)
      .select();

    expect(updated).toEqual([]); // RLS filtered the row out — update is a no-op

    // Verify B's row is unchanged
    const { data: stillB } = await asAdmin()
      .from("chainthings_memory_entries")
      .select("content")
      .eq("id", bRow.id)
      .single();

    expect(stillB?.content).toBe("original fact");
  });

  it("cross-tenant DELETE: tenant A cannot delete tenant B's memory entry", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow<{ id: string }>(
      asUser(b),
      "chainthings_memory_entries",
      { tenant_id: b.tenantId, category: "preference", content: "keep this memory" },
    );

    await asUser(a).from("chainthings_memory_entries").delete().eq("id", bRow.id);

    const { data: stillThere } = await asAdmin()
      .from("chainthings_memory_entries")
      .select("id")
      .eq("id", bRow.id);

    expect(stillThere).toHaveLength(1);
  });

  it("anon: cannot read memory entries", async () => {
    const t = await fixtureTenant("seed");

    await insertOrThrow(asUser(t), "chainthings_memory_entries", {
      tenant_id: t.tenantId,
      category: "task",
      content: "private task",
    });

    const { data } = await asAnon().from("chainthings_memory_entries").select("id");
    expect(data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// chainthings_notification_settings
// Note: this table has a unique(tenant_id, user_id) constraint; each fixture
// tenant has exactly one user, so use t.userId for the user_id column.
// ---------------------------------------------------------------------------
describe("RLS: chainthings_notification_settings", () => {

  it("same-tenant: insert + read own notification settings works", async () => {
    const t = await fixtureTenant("a");
    const client = asUser(t);

    const { data, error } = await client
      .from("chainthings_notification_settings")
      .insert({
        tenant_id: t.tenantId,
        user_id: t.userId,
        frequency: "weekly",
        timezone: "Asia/Taipei",
        send_hour_local: 9,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.frequency).toBe("weekly");
    expect(data?.tenant_id).toBe(t.tenantId);
  });

  it("cross-tenant SELECT: tenant A cannot see tenant B's notification settings", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    await insertOrThrow(asUser(b), "chainthings_notification_settings", {
      tenant_id: b.tenantId,
      user_id: b.userId,
      frequency: "daily",
      timezone: "Asia/Taipei",
      send_hour_local: 8,
    });

    const { data: aSeen } = await asUser(a)
      .from("chainthings_notification_settings")
      .select("id, frequency");

    expect(aSeen).toEqual([]);
  });

  it("cross-tenant INSERT: tenant A cannot insert with tenant B's id", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const { data, error } = await asUser(a)
      .from("chainthings_notification_settings")
      .insert({
        tenant_id: b.tenantId,
        user_id: b.userId,
        frequency: "weekly",
        timezone: "UTC",
        send_hour_local: 9,
      })
      .select();

    // Either the insert is blocked (error) or RLS hides the row (empty data).
    expect(error || data?.length === 0).toBeTruthy();
  });

  it("cross-tenant UPDATE: tenant A cannot modify tenant B's notification settings", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow<{ id: string; frequency: string }>(
      asUser(b),
      "chainthings_notification_settings",
      {
        tenant_id: b.tenantId,
        user_id: b.userId,
        frequency: "weekly",
        timezone: "Asia/Taipei",
        send_hour_local: 9,
      },
    );

    const { data: updated } = await asUser(a)
      .from("chainthings_notification_settings")
      .update({ frequency: "daily" })
      .eq("id", bRow.id)
      .select();

    expect(updated).toEqual([]); // RLS filtered the row out — update is a no-op

    // Verify B's row is unchanged
    const { data: stillB } = await asAdmin()
      .from("chainthings_notification_settings")
      .select("frequency")
      .eq("id", bRow.id)
      .single();

    expect(stillB?.frequency).toBe("weekly");
  });

  it("cross-tenant DELETE: tenant A cannot delete tenant B's notification settings", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow<{ id: string }>(
      asUser(b),
      "chainthings_notification_settings",
      {
        tenant_id: b.tenantId,
        user_id: b.userId,
        frequency: "biweekly",
        timezone: "Asia/Taipei",
        send_hour_local: 10,
      },
    );

    await asUser(a)
      .from("chainthings_notification_settings")
      .delete()
      .eq("id", bRow.id);

    const { data: stillThere } = await asAdmin()
      .from("chainthings_notification_settings")
      .select("id")
      .eq("id", bRow.id);

    expect(stillThere).toHaveLength(1);
  });

  it("anon: cannot read notification settings", async () => {
    const t = await fixtureTenant("seed");

    await insertOrThrow(asUser(t), "chainthings_notification_settings", {
      tenant_id: t.tenantId,
      user_id: t.userId,
      frequency: "weekly",
      timezone: "Asia/Taipei",
      send_hour_local: 9,
    });

    const { data } = await asAnon()
      .from("chainthings_notification_settings")
      .select("id");

    expect(data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// chainthings_notification_cache
// Required NOT NULL columns: tenant_id, user_id, period_start, period_end,
// scheduled_for_utc. period_start/period_end are date columns; use ISO date
// strings. content jsonb defaults to '{}'.
// ---------------------------------------------------------------------------
describe("RLS: chainthings_notification_cache", () => {

  it("same-tenant: insert + read own notification cache works", async () => {
    const t = await fixtureTenant("a");
    const client = asUser(t);

    const { data, error } = await client
      .from("chainthings_notification_cache")
      .insert({
        tenant_id: t.tenantId,
        user_id: t.userId,
        period_start: "2026-01-01",
        period_end: "2026-01-07",
        scheduled_for_utc: new Date().toISOString(),
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.tenant_id).toBe(t.tenantId);
    expect(data?.status).toBe("generated");
  });

  it("cross-tenant SELECT: tenant A cannot see tenant B's notification cache", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    await insertOrThrow(asUser(b), "chainthings_notification_cache", {
      tenant_id: b.tenantId,
      user_id: b.userId,
      period_start: "2026-01-01",
      period_end: "2026-01-07",
      scheduled_for_utc: new Date().toISOString(),
    });

    const { data: aSeen } = await asUser(a)
      .from("chainthings_notification_cache")
      .select("id, status");

    expect(aSeen).toEqual([]);
  });

  it("cross-tenant INSERT: tenant A cannot insert with tenant B's id", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const { data, error } = await asUser(a)
      .from("chainthings_notification_cache")
      .insert({
        tenant_id: b.tenantId,
        user_id: b.userId,
        period_start: "2026-01-01",
        period_end: "2026-01-07",
        scheduled_for_utc: new Date().toISOString(),
      })
      .select();

    // Either the insert is blocked (error) or RLS hides the row (empty data).
    expect(error || data?.length === 0).toBeTruthy();
  });

  it("cross-tenant UPDATE: tenant A cannot modify tenant B's notification cache", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow<{ id: string; status: string }>(
      asUser(b),
      "chainthings_notification_cache",
      {
        tenant_id: b.tenantId,
        user_id: b.userId,
        period_start: "2026-01-01",
        period_end: "2026-01-07",
        scheduled_for_utc: new Date().toISOString(),
        status: "generated",
      },
    );

    const { data: updated } = await asUser(a)
      .from("chainthings_notification_cache")
      .update({ status: "shown" })
      .eq("id", bRow.id)
      .select();

    expect(updated).toEqual([]); // RLS filtered the row out — update is a no-op

    // Verify B's row is unchanged
    const { data: stillB } = await asAdmin()
      .from("chainthings_notification_cache")
      .select("status")
      .eq("id", bRow.id)
      .single();

    expect(stillB?.status).toBe("generated");
  });

  it("cross-tenant DELETE: tenant A cannot delete tenant B's notification cache", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow<{ id: string }>(
      asUser(b),
      "chainthings_notification_cache",
      {
        tenant_id: b.tenantId,
        user_id: b.userId,
        period_start: "2026-02-01",
        period_end: "2026-02-07",
        scheduled_for_utc: new Date().toISOString(),
      },
    );

    await asUser(a)
      .from("chainthings_notification_cache")
      .delete()
      .eq("id", bRow.id);

    const { data: stillThere } = await asAdmin()
      .from("chainthings_notification_cache")
      .select("id")
      .eq("id", bRow.id);

    expect(stillThere).toHaveLength(1);
  });

  it("anon: cannot read notification cache", async () => {
    const t = await fixtureTenant("seed");

    await insertOrThrow(asUser(t), "chainthings_notification_cache", {
      tenant_id: t.tenantId,
      user_id: t.userId,
      period_start: "2026-01-01",
      period_end: "2026-01-07",
      scheduled_for_utc: new Date().toISOString(),
    });

    const { data } = await asAnon()
      .from("chainthings_notification_cache")
      .select("id");

    expect(data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// RLS: notification — parent-child FK isolation
//
// Schema context (011_notifications.sql):
//   chainthings_notification_settings.user_id  → auth.users(id) ON DELETE CASCADE
//   chainthings_notification_cache.user_id      → auth.users(id) ON DELETE CASCADE
//   RLS policy for both tables: tenant_id = chainthings_current_tenant_id()
//
// The FK accepts *any* valid auth.users.id, not just the caller's own user_id.
// RLS only checks tenant_id. Therefore: if tenant A authenticates (so their
// tenant_id is used by the policy) but supplies B's user_id in the row, the
// insert may succeed — FK accepts B's valid auth.users.id, RLS sees A's
// tenant_id matching A's session. This is a cross-tenant user_id spoof.
// ---------------------------------------------------------------------------
describe("RLS: notification — parent-child FK isolation", () => {

  // FOLLOW-UP / SECURITY GAP captured by both tests below:
  //   The RLS policy on chainthings_notification_{settings,cache} only checks
  //   tenant_id = chainthings_current_tenant_id(). It does NOT verify
  //   user_id = auth.uid(). Combined with the FK accepting any valid
  //   auth.users.id, tenant A can write a row whose user_id belongs to
  //   tenant B's user — a cross-user/cross-tenant data association.
  //
  //   Suggested fix: change the policy to
  //     using (tenant_id = chainthings_current_tenant_id() and user_id = auth.uid())
  //
  //   These tests document the CURRENT vulnerable behavior. When the policy is
  //   tightened the assertions will fail and prompt an update.

  it("notification_settings: cross-user spoof is currently accepted (policy gap)", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const { data, error } = await asUser(a)
      .from("chainthings_notification_settings")
      .insert({
        tenant_id: a.tenantId,
        user_id: b.userId, // spoofed: B's user_id in A's tenant
        frequency: "weekly",
        timezone: "UTC",
        send_hour_local: 9,
      })
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].tenant_id).toBe(a.tenantId);
    expect(data?.[0].user_id).toBe(b.userId);
  });

  it("notification_cache: cross-user spoof is currently accepted (policy gap)", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const { data, error } = await asUser(a)
      .from("chainthings_notification_cache")
      .insert({
        tenant_id: a.tenantId,
        user_id: b.userId, // spoofed: B's user_id in A's tenant
        period_start: "2026-03-01",
        period_end: "2026-03-07",
        scheduled_for_utc: new Date().toISOString(),
      })
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].tenant_id).toBe(a.tenantId);
    expect(data?.[0].user_id).toBe(b.userId);
  });
});
