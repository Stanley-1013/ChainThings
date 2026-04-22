import { chatCompletion } from "@/lib/ai-gateway";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Issue, MergeRequest } from "../types";

const SUMMARY_SYSTEM_PROMPT = `You are a project management assistant generating sprint/weekly progress summaries.

Given a list of issues and merge requests, produce a concise Markdown summary covering:
1. **Completed** — merged PRs and closed tickets
2. **In Progress** — open PRs and active tickets
3. **Blocked / At Risk** — items with no recent activity or failing checks
4. **Key Metrics** — tickets closed, PRs merged, average review time (if available)

Format as clean Markdown with headers and bullet points. Be concise.`;

export interface SummaryInput {
  issues: Issue[];
  mergeRequests: MergeRequest[];
  dateRange?: { from: string; to: string };
  language?: string;
}

export interface SummaryResult {
  markdown: string;
  aiModel?: string;
  tokenUsage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function generateSprintSummary(input: SummaryInput): Promise<SummaryResult> {
  const issueSection = input.issues.length > 0
    ? `Issues (${input.issues.length}):\n${input.issues.map((i) => `- [${i.ref}] ${i.title} (${i.state}) ${i.url}`).join("\n")}`
    : "No issues found.";

  const mrSection = input.mergeRequests.length > 0
    ? `Merge Requests (${input.mergeRequests.length}):\n${input.mergeRequests.map((mr) => `- [${mr.ref}] ${mr.title} (${mr.state}) by ${mr.author} ${mr.url}`).join("\n")}`
    : "No merge requests found.";

  const dateNote = input.dateRange
    ? `Period: ${input.dateRange.from} to ${input.dateRange.to}`
    : "";

  const langNote = input.language && input.language !== "en"
    ? `\nRespond in ${input.language}.`
    : "";

  const messages = [
    { role: "system" as const, content: SUMMARY_SYSTEM_PROMPT + langNote },
    { role: "user" as const, content: `${dateNote}\n\n${issueSection}\n\n${mrSection}` },
  ];

  const response = await chatCompletion(messages, undefined, {});

  return {
    markdown: response.choices[0]?.message.content?.trim() ?? "No summary generated.",
    aiModel: response.id,
    tokenUsage: {
      prompt_tokens: response.usage?.prompt_tokens,
      completion_tokens: response.usage?.completion_tokens,
    },
  };
}

export async function summarizeMergeRequest(
  mr: MergeRequest,
  diff: string,
  language?: string,
): Promise<SummaryResult> {
  const langNote = language && language !== "en" ? `\nRespond in ${language}.` : "";

  const messages = [
    {
      role: "system" as const,
      content: `You are a technical writer. Summarize this merge request in 3-5 bullet points covering: purpose, key changes, potential impact, and anything reviewers should pay attention to.${langNote}`,
    },
    {
      role: "user" as const,
      content: `MR: ${mr.title}\nAuthor: ${mr.author}\nBranch: ${mr.sourceBranch} → ${mr.targetBranch}\nURL: ${mr.url}\n\nDiff (truncated):\n${diff.slice(0, 8000)}`,
    },
  ];

  const response = await chatCompletion(messages, undefined, {});

  return {
    markdown: response.choices[0]?.message.content?.trim() ?? "No summary generated.",
    aiModel: response.id,
    tokenUsage: {
      prompt_tokens: response.usage?.prompt_tokens,
      completion_tokens: response.usage?.completion_tokens,
    },
  };
}

export async function cacheSummary(
  tenantId: string,
  markdown: string,
  category: string,
): Promise<void> {
  await supabaseAdmin.from("chainthings_memory_entries").insert({
    tenant_id: tenantId,
    category: "summary",
    content: markdown,
    importance: 6,
    status: "active",
    source_type: "manual",
    metadata: { generated_by: "dev-service-summary", sub_category: category },
  });
}
