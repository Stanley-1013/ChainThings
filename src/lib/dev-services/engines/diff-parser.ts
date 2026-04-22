/** Parses unified diff into per-file sections for AI review. */

export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  hunks: string;
  addedLines: number;
  removedLines: number;
}

const GENERATED_PATTERNS = [
  /\.lock$/,
  /\.min\.(js|css)$/,
  /^dist\//,
  /^build\//,
  /^\.next\//,
  /^node_modules\//,
  /\.snap$/,
  /\.map$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
];

export function parseDiff(rawDiff: string): DiffFile[] {
  const sections = rawDiff.split(/(?=^diff --git )/m).filter(Boolean);
  const files: DiffFile[] = [];

  for (const section of sections) {
    const headerMatch = section.match(
      /^diff --git a\/(.+?) b\/(.+?)$/m,
    );
    if (!headerMatch) continue;

    const pathA = headerMatch[1];
    const pathB = headerMatch[2];
    const path = pathB ?? pathA;

    // Skip generated/binary files
    if (GENERATED_PATTERNS.some((p) => p.test(path))) continue;
    if (section.includes("Binary files")) continue;

    let status: DiffFile["status"] = "modified";
    if (section.includes("new file mode")) status = "added";
    else if (section.includes("deleted file mode")) status = "deleted";
    else if (section.includes("rename from") || pathA !== pathB) status = "renamed";

    // Extract hunks (lines starting with @@ or +/- lines)
    const hunkLines = section
      .split("\n")
      .filter(
        (line) =>
          line.startsWith("@@") ||
          line.startsWith("+") ||
          line.startsWith("-") ||
          line.startsWith(" "),
      );

    let added = 0;
    let removed = 0;
    for (const line of hunkLines) {
      if (line.startsWith("+") && !line.startsWith("+++")) added++;
      if (line.startsWith("-") && !line.startsWith("---")) removed++;
    }

    files.push({
      path,
      status,
      hunks: section,
      addedLines: added,
      removedLines: removed,
    });
  }

  return files;
}

export function splitDiffByTokenBudget(
  files: DiffFile[],
  maxTokensPerChunk: number,
): DiffFile[][] {
  const estimateTokens = (s: string) => Math.ceil(s.length / 4);
  const chunks: DiffFile[][] = [];
  let current: DiffFile[] = [];
  let currentTokens = 0;

  // Sort: smaller files first so we can pack more per chunk
  const sorted = [...files].sort(
    (a, b) => a.hunks.length - b.hunks.length,
  );

  for (const file of sorted) {
    const tokens = estimateTokens(file.hunks);
    if (tokens > maxTokensPerChunk) {
      // Single file exceeds budget — truncate and put in its own chunk
      const truncated = file.hunks.slice(0, maxTokensPerChunk * 4);
      chunks.push([
        { ...file, hunks: truncated + "\n... diff truncated ..." },
      ]);
      continue;
    }
    if (currentTokens + tokens > maxTokensPerChunk && current.length > 0) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(file);
    currentTokens += tokens;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
