import { afterAll, beforeAll } from "vitest";
import { getStackConfig } from "./helpers/stack-config";
import { truncateAll } from "./helpers/reset";

// Integration-only setup. Verifies the local Supabase test stack is alive
// before any test runs. Does NOT call `vi.mock` — those mocks belong to
// unit suite (src/__tests__/setup.ts), and would defeat the purpose
// of integration testing.

beforeAll(async () => {
  const config = getStackConfig();

  // Sanity-check: stack must be reachable
  const health = await fetch(`${config.url}/rest/v1/`, {
    headers: { apikey: config.anonKey },
  }).catch((err) => {
    throw new Error(
      `Cannot reach Supabase test stack at ${config.url}. ` +
        `Run \`make test-stack-up\` first. Underlying error: ${err.message}`,
    );
  });

  if (!health.ok && health.status !== 401 && health.status !== 404) {
    throw new Error(
      `Supabase test stack returned ${health.status} from /rest/v1/. ` +
        `Stack may be partially started. Try \`make test-stack-down && make test-stack-up\`.`,
    );
  }

  // Start each suite from a known-clean state. truncateAll deletes
  // auth.users which cascades through profiles → all business tables.
  await truncateAll();
});

afterAll(async () => {
  // Don't leave fixtures behind for the next CI run / dev session.
  await truncateAll();
});
