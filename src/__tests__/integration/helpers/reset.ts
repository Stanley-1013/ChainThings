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
//
// Pagination: GoTrue caps results per page; we keep fetching until the
// API returns 0 matching users (rather than assuming a single page
// covers all fixtures). Per-page limit of 100 stays safely under the
// GoTrue API ceiling.

const TEST_EMAIL_DOMAIN = "test.local";
const PAGE_SIZE = 100;

export async function truncateAll(): Promise<void> {
  const admin = asAdmin();
  const failures: string[] = [];

  // Paginate until a page returns 0 test-domain users.
  let page = 1;
  while (true) {
    const { data: pages, error: listErr } =
      await admin.auth.admin.listUsers({
        page,
        perPage: PAGE_SIZE,
      });

    if (listErr) {
      throw new Error(`truncateAll: listUsers (page ${page}) failed: ${listErr.message}`);
    }

    const testUsers = pages.users.filter((u) =>
      u.email?.endsWith(`@${TEST_EMAIL_DOMAIN}`),
    );

    // No more matching users on this page — we're done.
    if (testUsers.length === 0) break;

    for (const user of testUsers) {
      const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
      if (delErr) {
        failures.push(`${user.email}: ${delErr.message}`);
      }
    }

    page++;
  }

  if (failures.length > 0) {
    throw new Error(
      `truncateAll: ${failures.length} user(s) could not be deleted — dirty state likely:\n` +
        failures.map((f) => `  • ${f}`).join("\n"),
    );
  }
}
