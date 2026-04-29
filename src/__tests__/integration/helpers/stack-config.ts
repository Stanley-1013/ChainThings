// Reads the local Supabase test stack URLs/keys.
//
// Two sources, in order of priority:
//   1. Env vars (set by CI: SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY,
//      SUPABASE_TEST_SERVICE_ROLE_KEY) — explicit, no surprises
//   2. CLI defaults (CLI v2 publishes deterministic dev keys for local
//      stacks, documented at https://supabase.com/docs/guides/cli/local-development)
//
// We do NOT shell out to `supabase status -o json` here because that
// adds a process spawn per test file. The CLI keys are stable across
// versions, so hardcoding them as fallback is safe.

export interface StackConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

// CLI v2 default keys for local development — see
// https://github.com/supabase/cli/blob/main/internal/utils/config.go
const CLI_DEFAULT_URL = "http://127.0.0.1:54321";
const CLI_DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const CLI_DEFAULT_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

export function getStackConfig(): StackConfig {
  return {
    url: process.env.SUPABASE_TEST_URL ?? CLI_DEFAULT_URL,
    anonKey: process.env.SUPABASE_TEST_ANON_KEY ?? CLI_DEFAULT_ANON_KEY,
    serviceRoleKey:
      process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ??
      CLI_DEFAULT_SERVICE_ROLE_KEY,
  };
}
