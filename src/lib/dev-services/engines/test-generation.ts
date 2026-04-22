import { createHash } from "node:crypto";
import { chatCompletion } from "@/lib/ai-gateway";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { parseDiff } from "./diff-parser";

interface TestGenResult {
  generatedTests: string;
  language: string;
  framework: string;
  aiModel?: string;
  tokenUsage?: { prompt_tokens?: number; completion_tokens?: number };
}

const LANG_MAP: Record<string, { language: string; framework: string }> = {
  ".ts": { language: "typescript", framework: "vitest" },
  ".tsx": { language: "typescript", framework: "vitest" },
  ".js": { language: "javascript", framework: "jest" },
  ".jsx": { language: "javascript", framework: "jest" },
  ".py": { language: "python", framework: "pytest" },
  ".go": { language: "go", framework: "testing" },
  ".rs": { language: "rust", framework: "cargo test" },
  ".java": { language: "java", framework: "junit" },
};

function detectLang(filePath: string, code: string): { language: string; framework: string } {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  const detected = LANG_MAP[ext];
  if (detected) {
    // Refine framework from code content
    if (detected.language === "typescript" || detected.language === "javascript") {
      if (code.includes("vitest") || code.includes("from 'vitest'")) return { ...detected, framework: "vitest" };
      if (code.includes("jest") || code.includes("describe(")) return { ...detected, framework: "jest" };
      if (code.includes("mocha") || code.includes("it(")) return { ...detected, framework: "mocha" };
    }
    return detected;
  }
  return { language: "unknown", framework: "unknown" };
}

function buildPrompt(language: string, framework: string, filePath: string): string {
  return `You are an expert test engineer. Generate comprehensive unit tests for the provided code.

Context:
- Language: ${language}
- Test framework: ${framework}
- File under test: ${filePath}

Requirements:
1. Test all public functions/methods
2. Include edge cases: null/undefined, empty arrays, boundary values
3. Test error handling paths
4. Use descriptive test names (describe → it pattern)
5. Mock external dependencies (database, API calls, file system)
6. Aim for branch coverage, not just line coverage

Output ONLY the test file content, ready to save. No explanatory text.`;
}

export async function generateTestsFromCode(
  sourceCode: string,
  filePath: string,
): Promise<TestGenResult> {
  const { language, framework } = detectLang(filePath, sourceCode);

  const messages = [
    { role: "system" as const, content: buildPrompt(language, framework, filePath) },
    { role: "user" as const, content: `Generate tests for:\n\n\`\`\`${language}\n${sourceCode}\n\`\`\`` },
  ];

  const response = await chatCompletion(messages, undefined, {});
  let tests = response.choices[0]?.message.content?.trim() ?? "";
  // Strip markdown fences
  tests = tests.replace(/^```[\w]*\s*/i, "").replace(/```\s*$/i, "").trim();

  return {
    generatedTests: tests,
    language,
    framework,
    aiModel: response.id,
    tokenUsage: {
      prompt_tokens: response.usage?.prompt_tokens,
      completion_tokens: response.usage?.completion_tokens,
    },
  };
}

export async function generateTestsFromDiff(diff: string): Promise<TestGenResult> {
  const files = parseDiff(diff);
  const codeFiles = files.filter(
    (f) => f.status !== "deleted" && !f.path.includes(".test.") && !f.path.includes(".spec."),
  );
  if (codeFiles.length === 0) {
    return { generatedTests: "// No testable code changes found in diff", language: "unknown", framework: "unknown" };
  }

  // Extract added/modified lines from hunks
  const codeSnippets = codeFiles
    .slice(0, 5) // Limit to 5 files
    .map((f) => {
      const addedLines = f.hunks
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
        .map((l) => l.slice(1))
        .join("\n");
      return `// File: ${f.path}\n${addedLines}`;
    })
    .join("\n\n");

  const primaryFile = codeFiles[0];
  const { language, framework } = detectLang(primaryFile.path, codeSnippets);

  const messages = [
    { role: "system" as const, content: buildPrompt(language, framework, primaryFile.path) },
    {
      role: "user" as const,
      content: `Generate tests for these new/changed functions:\n\n\`\`\`${language}\n${codeSnippets}\n\`\`\``,
    },
  ];

  const response = await chatCompletion(messages, undefined, {});
  let tests = response.choices[0]?.message.content?.trim() ?? "";
  tests = tests.replace(/^```[\w]*\s*/i, "").replace(/```\s*$/i, "").trim();

  return {
    generatedTests: tests,
    language,
    framework,
    aiModel: response.id,
    tokenUsage: {
      prompt_tokens: response.usage?.prompt_tokens,
      completion_tokens: response.usage?.completion_tokens,
    },
  };
}

export async function saveTestGeneration(
  tenantId: string,
  integrationId: string,
  service: string,
  repoRef: string,
  sourceType: "mr_diff" | "file" | "snippet",
  sourceRef: string,
  sourceCode: string,
  result: TestGenResult,
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("chainthings_test_generations")
    .insert({
      tenant_id: tenantId,
      integration_id: integrationId,
      service,
      repo_ref: repoRef,
      source_type: sourceType,
      source_ref: sourceRef,
      source_summary: sourceCode.slice(0, 500),
      source_hash: createHash("sha256").update(sourceCode).digest("hex"),
      generated_tests: result.generatedTests,
      language: result.language,
      framework: result.framework,
      ai_model: result.aiModel,
      token_usage: result.tokenUsage,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to save test generation: ${error.message}`);
  return data.id;
}
