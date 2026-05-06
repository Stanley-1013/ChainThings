import { describe, it, expect } from "vitest";
import { fixtureTenant, asUser, asAdmin, asAnon, insertOrThrow } from "../helpers/fixtures";

// RLS contract for chat data:
//   policy "Tenant isolation for conversations" — for all using (tenant_id = chainthings_current_tenant_id())
//   policy "Tenant isolation for messages"      — for all using (tenant_id = chainthings_current_tenant_id())
// Cross-tenant SELECT/UPDATE/DELETE/INSERT must be blocked. Anon must see nothing.

// ---------------------------------------------------------------------------
// chainthings_conversations
// ---------------------------------------------------------------------------
describe("RLS: chainthings_conversations", () => {

  it("same-tenant: insert + read own conversation works", async () => {
    const t = await fixtureTenant("a");
    const client = asUser(t);

    const { data, error } = await client
      .from("chainthings_conversations")
      .insert({ tenant_id: t.tenantId, title: "hello" })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data?.title).toBe("hello");
    expect(data?.tenant_id).toBe(t.tenantId);
  });

  it("cross-tenant SELECT: tenant A cannot see tenant B's conversations", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    await insertOrThrow<{ id: string; tenant_id: string }>(
      asUser(b),
      "chainthings_conversations",
      { tenant_id: b.tenantId, title: "B's chat" },
    );

    const { data: aSeen } = await asUser(a)
      .from("chainthings_conversations")
      .select("id, title");
    expect(aSeen).toEqual([]);
  });

  it("cross-tenant INSERT: tenant A cannot insert with tenant B's id", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const { data, error } = await asUser(a)
      .from("chainthings_conversations")
      .insert({ tenant_id: b.tenantId, title: "spoof" })
      .select();

    // Either the insert is blocked (error) or RLS hides the row (empty data).
    // Either is a valid pass. The bad case is `data` containing a row visible
    // outside tenant A's scope.
    expect(error || data?.length === 0).toBeTruthy();
  });

  it("cross-tenant UPDATE: tenant A cannot modify tenant B's row", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow<{ id: string; tenant_id: string }>(
      asUser(b),
      "chainthings_conversations",
      { tenant_id: b.tenantId, title: "original" },
    );

    const { data: updated } = await asUser(a)
      .from("chainthings_conversations")
      .update({ title: "hijacked" })
      .eq("id", bRow.id)
      .select();
    expect(updated).toEqual([]); // RLS filtered the row out — update is a no-op

    // Verify B's row is unchanged
    const { data: stillB } = await asAdmin()
      .from("chainthings_conversations")
      .select("title")
      .eq("id", bRow.id)
      .single();
    expect(stillB?.title).toBe("original");
  });

  it("cross-tenant DELETE: tenant A cannot delete tenant B's row", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bRow = await insertOrThrow<{ id: string; tenant_id: string }>(
      asUser(b),
      "chainthings_conversations",
      { tenant_id: b.tenantId, title: "keep me" },
    );

    await asUser(a).from("chainthings_conversations").delete().eq("id", bRow.id);

    const { data: stillThere } = await asAdmin()
      .from("chainthings_conversations")
      .select("id")
      .eq("id", bRow.id);
    expect(stillThere).toHaveLength(1);
  });

  it("anon: cannot read conversations", async () => {
    const t = await fixtureTenant("seed");
    await asUser(t)
      .from("chainthings_conversations")
      .insert({ tenant_id: t.tenantId, title: "x" });

    const { data: convs } = await asAnon()
      .from("chainthings_conversations")
      .select("id");
    expect(convs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// chainthings_messages
// Schema: id, conversation_id FK conversations.id, tenant_id FK profiles.tenant_id,
//         role in ('user','assistant','system'), content text, metadata jsonb
// ---------------------------------------------------------------------------
describe("RLS: chainthings_messages", () => {

  it("same-tenant: insert + read own messages works", async () => {
    const t = await fixtureTenant("a");

    const conv = await insertOrThrow<{ id: string; tenant_id: string }>(
      asUser(t),
      "chainthings_conversations",
      { tenant_id: t.tenantId, title: "my chat" },
    );

    const { data, error } = await asUser(t)
      .from("chainthings_messages")
      .insert({
        conversation_id: conv.id,
        tenant_id: t.tenantId,
        role: "user",
        content: "hello world",
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.content).toBe("hello world");
    expect(data?.tenant_id).toBe(t.tenantId);
    expect(data?.conversation_id).toBe(conv.id);
  });

  it("cross-tenant SELECT: tenant A cannot see tenant B's messages", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bConv = await insertOrThrow<{ id: string; tenant_id: string }>(
      asUser(b),
      "chainthings_conversations",
      { tenant_id: b.tenantId, title: "B" },
    );

    await insertOrThrow<{ id: string }>(
      asUser(b),
      "chainthings_messages",
      {
        conversation_id: bConv.id,
        tenant_id: b.tenantId,
        role: "user",
        content: "secret",
      },
    );

    const { data: aSees } = await asUser(a)
      .from("chainthings_messages")
      .select("id, content");
    expect(aSees).toEqual([]);
  });

  it("cross-tenant INSERT: tenant A cannot insert a message with tenant B's id", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const aConv = await insertOrThrow<{ id: string; tenant_id: string }>(
      asUser(a),
      "chainthings_conversations",
      { tenant_id: a.tenantId, title: "A's chat" },
    );

    const { data, error } = await asUser(a)
      .from("chainthings_messages")
      .insert({
        conversation_id: aConv.id,
        tenant_id: b.tenantId,
        role: "user",
        content: "spoof message",
      })
      .select();

    // Either the insert is blocked (error) or RLS hides the row (empty data).
    // Either is a valid pass. The bad case is `data` containing a row visible
    // outside tenant A's scope.
    expect(error || data?.length === 0).toBeTruthy();
  });

  it("cross-tenant UPDATE: tenant A cannot modify tenant B's message", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bConv = await insertOrThrow<{ id: string; tenant_id: string }>(
      asUser(b),
      "chainthings_conversations",
      { tenant_id: b.tenantId, title: "B chat" },
    );

    const bMsg = await insertOrThrow<{ id: string }>(
      asUser(b),
      "chainthings_messages",
      {
        conversation_id: bConv.id,
        tenant_id: b.tenantId,
        role: "assistant",
        content: "original content",
      },
    );

    const { data: updated } = await asUser(a)
      .from("chainthings_messages")
      .update({ content: "hijacked" })
      .eq("id", bMsg.id)
      .select();
    expect(updated).toEqual([]); // RLS filtered the row out — update is a no-op

    // Verify B's message is unchanged
    const { data: stillB } = await asAdmin()
      .from("chainthings_messages")
      .select("content")
      .eq("id", bMsg.id)
      .single();
    expect(stillB?.content).toBe("original content");
  });

  it("cross-tenant DELETE: tenant A cannot delete tenant B's message", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    const bConv = await insertOrThrow<{ id: string; tenant_id: string }>(
      asUser(b),
      "chainthings_conversations",
      { tenant_id: b.tenantId, title: "B chat for delete test" },
    );

    const bMsg = await insertOrThrow<{ id: string }>(
      asUser(b),
      "chainthings_messages",
      {
        conversation_id: bConv.id,
        tenant_id: b.tenantId,
        role: "user",
        content: "keep this message",
      },
    );

    await asUser(a).from("chainthings_messages").delete().eq("id", bMsg.id);

    const { data: stillThere } = await asAdmin()
      .from("chainthings_messages")
      .select("id")
      .eq("id", bMsg.id);
    expect(stillThere).toHaveLength(1);
  });

  it("anon: cannot read messages", async () => {
    const t = await fixtureTenant("seed");

    const conv = await insertOrThrow<{ id: string; tenant_id: string }>(
      asUser(t),
      "chainthings_conversations",
      { tenant_id: t.tenantId, title: "anon test conv" },
    );

    await asUser(t)
      .from("chainthings_messages")
      .insert({
        conversation_id: conv.id,
        tenant_id: t.tenantId,
        role: "user",
        content: "private message",
      });

    const { data: msgs } = await asAnon().from("chainthings_messages").select("id");
    expect(msgs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// RLS: messages — parent-child FK isolation
//
// The messages table has two independent FK constraints:
//   - conversation_id → chainthings_conversations(id)
//   - tenant_id       → chainthings_profiles(tenant_id)
//
// The RLS policy only checks tenant_id = chainthings_current_tenant_id().
// A message with a valid tenant_id (A's own) but a foreign conversation_id
// (B's conversation) satisfies both FK constraints AND the RLS policy, so
// the insert succeeds. This is a known design gap: the policy does not
// enforce conversation_id ownership.
// ---------------------------------------------------------------------------
describe("RLS: messages — parent-child FK isolation", () => {

  it("cross-tenant FK: A cannot insert a message referencing B's conversation", async () => {
    const a = await fixtureTenant("a");
    const b = await fixtureTenant("b");

    // B creates a conversation; A creates one too (so A has a valid context)
    const bConv = await insertOrThrow<{ id: string; tenant_id: string }>(
      asUser(b),
      "chainthings_conversations",
      { tenant_id: b.tenantId, title: "B's private conversation" },
    );

    await insertOrThrow<{ id: string; tenant_id: string }>(
      asUser(a),
      "chainthings_conversations",
      { tenant_id: a.tenantId, title: "A's own conversation" },
    );

    // Attack: A links a message (tenant_id=a.tenantId) to B's conversation.
    // The strengthened WITH CHECK policy now verifies that conversation_id
    // resolves to a conversation owned by the caller's tenant, blocking this.
    const { data, error } = await asUser(a)
      .from("chainthings_messages")
      .insert({
        conversation_id: bConv.id,
        tenant_id: a.tenantId,
        role: "user",
        content: "A's message in B's conversation",
      })
      .select();

    // The insert must be blocked (error) or the row hidden by RLS (empty data).
    expect(error || data?.length === 0).toBeTruthy();
  });
});
