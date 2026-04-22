import { describe, it, expect } from "vitest";
import { parseDiff, splitDiffByTokenBudget } from "./diff-parser";

// ── Minimal two-file unified diff ──────────────────────────────────────────
const TWO_FILE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const x = 1;
+const y = 2;
 const z = 3;
-const old = 4;
diff --git a/src/bar.ts b/src/bar.ts
new file mode 100644
index 000..111
--- /dev/null
+++ b/src/bar.ts
@@ -0,0 +1,2 @@
+export function hello() {}
+export function world() {}
`;

// ── Diff that includes files that should be skipped ────────────────────────
const SKIPPABLE_DIFF = `diff --git a/package-lock.json b/package-lock.json
index 000..111 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1 +1 @@
-{}
+{"version":2}
diff --git a/node_modules/foo/index.js b/node_modules/foo/index.js
index 000..111 100644
--- a/node_modules/foo/index.js
+++ b/node_modules/foo/index.js
@@ -1 +1 @@
-old
+new
diff --git a/src/real.ts b/src/real.ts
index 000..111 100644
--- a/src/real.ts
+++ b/src/real.ts
@@ -1 +1 @@
-old
+new
`;

describe("parseDiff", () => {
  it("parses a two-file diff and returns both files with correct metadata", () => {
    const files = parseDiff(TWO_FILE_DIFF);
    expect(files).toHaveLength(2);

    const foo = files.find((f) => f.path === "src/foo.ts");
    expect(foo).toBeDefined();
    expect(foo?.status).toBe("modified");
    expect(foo?.addedLines).toBe(1);
    expect(foo?.removedLines).toBe(1);

    const bar = files.find((f) => f.path === "src/bar.ts");
    expect(bar).toBeDefined();
    expect(bar?.status).toBe("added");
    expect(bar?.addedLines).toBe(2);
    expect(bar?.removedLines).toBe(0);
  });

  it("skips .lock files and node_modules/ paths", () => {
    const files = parseDiff(SKIPPABLE_DIFF);
    // Only src/real.ts should survive
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/real.ts");
  });
});

describe("splitDiffByTokenBudget", () => {
  it("packs small files into one chunk when under budget", () => {
    const files = parseDiff(TWO_FILE_DIFF);
    // Budget large enough to hold both (~tokens = ceil(len/4))
    const chunks = splitDiffByTokenBudget(files, 10_000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(2);
  });

  it("starts a new chunk when adding the next file would exceed the budget", () => {
    const files = parseDiff(TWO_FILE_DIFF);
    // Estimate tokens for each file: small budget forces a split
    // Each section is ~100-300 chars, so budget=10 tokens (40 chars) forces split
    const chunks = splitDiffByTokenBudget(files, 10);
    // Each file exceeds the tiny budget so each lands in its own chunk
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});
