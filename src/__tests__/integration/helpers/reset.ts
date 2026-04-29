import { asAdmin } from "./fixtures";

// truncateAll() — reset DB to a clean state.
//
// Strategy: delete all auth.users created by the test suite. Because
// every chainthings_* table has FK chainthings_profiles(tenant_id) ON
// DELETE CASCADE, and chainthings_profiles itself has FK auth.users(id)
// ON DELETE CASCADE, deleting auth.users alone cascades through
// profiles → all 18+ business tables.
//
// We filter by the test email domain (`@test.local`) so this is safe
// to call against any Supabase instance — it only touches rows the
// test suite created.

const TEST_EMAIL_DOMAIN = "test.local";

export async function truncateAll(): Promise<void> {
  const admin = asAdmin();

  // List + delete users with test email — the GoTrue admin API doesn't
  // support batch delete, so iterate. Page size 100 is enough for a
  // test suite that creates ~50-100 fixtures per run.
  const { data: pages, error: listErr } =
    await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

  if (listErr) {
    throw new Error(`truncateAll: listUsers failed: ${listErr.message}`);
  }

  const testUsers = pages.users.filter((u) =>
    u.email?.endsWith(`@${TEST_EMAIL_DOMAIN}`),
  );

  for (const user of testUsers) {
    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) {
      // Don't fail the whole truncate — log and continue, since
      // a partial truncate is better than none.
      console.warn(
        `truncateAll: failed to delete ${user.email}: ${delErr.message}`,
      );
    }
  }
}
