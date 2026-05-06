import { defineConfig } from "vitest/config";
import path from "path";

// Integration test config — connects to a REAL Supabase test stack
// (started via `make test-stack-up` / `supabase start`).
//
// Critically does NOT load src/__tests__/setup.ts: that file mocks
// @/lib/supabase/server which would prevent real DB access. RLS
// tests need the real client.
//
// fileParallelism: false is required because RLS tests share global DB state
// (auth.users + business tables) and cannot run in parallel.

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/__tests__/integration/**/*.test.ts"],
    setupFiles: ["src/__tests__/integration/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // RLS tests share a single Postgres + GoTrue stack; running test files
    // in parallel would have them clobber each other's auth.users state.
    // Tests within a file already run serially by default in vitest.
    fileParallelism: false,
  },
});
