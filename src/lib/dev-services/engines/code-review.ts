import { chatCompletion } from "@/lib/ai-gateway";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CodeHostClient, ReviewComment } from "../types";
import { parseDiff, splitDiffByTokenBudget } from "./diff-parser";

const MAX_TOKENS_PER_CHUNK = 6000;

const REVIEW_SYSTEM_PROMPT = `You are an expert code reviewer. Analyze the diff and return a JSON array of review comments.

For each issue, return:
- "path": file path relative to repo root
- "line": line number in the NEW file (from @@ hunk header, + side)
- "severity": "critical" | "warning" | "suggestion" | "praise"
- "body": review comment in markdown
- "suggestion": optional corrected code (GitHub suggestion format)

Focus on:
1. Bugs and runtime errors
2. Security vulnerabilities (injection, auth bypass, data leakage)
3. Performance issues (N+1, memory leaks, unnecessary re-renders)
4. Missing error handling
5. Type safety issues

Do NOT comment on: style/formatting, import ordering, minor naming preferences.
If the code looks good, return: [{"path":"","line":0,"severity":"praise","body":"LGTM! ..."}]

Respond ONLY with the JSON array. No markdown fences, no explanation.`;

export interface ReviewDraftResult {
  comments: ReviewComment[];
  diffSummary: string;
  aiModel?: string;
  tokenUsage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function generateReviewDraft(
  diff: string,
  subject: { type: string; ref: string; title: string; url: string },
  options?: { language?: string },
): Promise<ReviewDraftResult> {
  const files = parseDiff(diff);
  if (files.length === 0) {
    return { comments: [], diffSummary: "No reviewable changes." };
  }

  const chunks = splitDiffByTokenBudget(files, MAX_TOKENS_PER_CHUNK);
  const allComments: ReviewComment[] = [];
  let aiModel: string | undefined;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  for (const chunk of chunks) {
    const chunkDiff = chunk.map((f) => f.hunks).join("\n");
    const fileList = chunk.map((f) => `${f.status}: ${f.path} (+${f.addedLines}/-${f.removedLines})`).join("\n");

    const langNote = options?.language && options.language !== "en"
      ? `\nRespond in ${options.language}.`
      : "";

    const messages = [
      { role: "system" as const, content: REVIEW_SYSTEM_PROMPT + langNote },
      {
        role: "user" as const,
        content: `Review this ${subject.type} "${subject.title}":\n\nFiles changed:\n${fileList}\n\nDiff:\n${chunkDiff}`,
      },
    ];

    const response = await chatCompletion(messages, undefined, {});
    aiModel = aiModel ?? response.id;
    totalPromptTokens += response.usage?.prompt_tokens ?? 0;
    totalCompletionTokens += response.usage?.completion_tokens ?? 0;

    const content = response.choices[0]?.message.content?.trim() ?? "[]";
    try {
      // Strip markdown fences if AI wraps it
      const cleaned = content.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned) as ReviewComment[];
      if (Array.isArray(parsed)) {
        allComments.push(...parsed.filter((c) => c.path && c.body));
      }
    } catch {
      // If parsing fails, create a single comment with the raw response
      allComments.push({
        path: "",
        line: 0,
        severity: "suggestion",
        body: `AI review response (unparsed):\n${content.slice(0, 500)}`,
      });
    }
  }

  // Dedup by path+line
  const seen = new Set<string>();
  const deduped = allComments.filter((c) => {
    const key = `${c.path}:${c.line}:${c.severity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Generate summary
  const totalAdded = files.reduce((s, f) => s + f.addedLines, 0);
  const totalRemoved = files.reduce((s, f) => s + f.removedLines, 0);
  const critical = deduped.filter((c) => c.severity === "critical").length;
  const warnings = deduped.filter((c) => c.severity === "warning").length;
  const diffSummary = `${files.length} files changed (+${totalAdded}/-${totalRemoved}). Found ${critical} critical, ${warnings} warnings, ${deduped.length} total comments.`;

  return {
    comments: deduped,
    diffSummary,
    aiModel,
    tokenUsage: {
      prompt_tokens: totalPromptTokens,
      completion_tokens: totalCompletionTokens,
    },
  };
}

export async function saveReviewDraft(
  tenantId: string,
  integrationId: string,
  service: string,
  repoRef: string,
  subject: { type: string; ref: string; title: string; url: string },
  draft: ReviewDraftResult,
  webhookEventId?: string,
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("chainthings_code_reviews")
    .insert({
      tenant_id: tenantId,
      integration_id: integrationId,
      webhook_event_id: webhookEventId,
      service,
      repo_ref: repoRef,
      subject_type: subject.type,
      subject_ref: subject.ref,
      subject_title: subject.title,
      subject_url: subject.url,
      diff_summary: draft.diffSummary,
      review_comments: draft.comments,
      review_status: "draft",
      ai_model: draft.aiModel,
      token_usage: draft.tokenUsage,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to save review draft: ${error.message}`);
  return data.id;
}

export async function submitReview(
  reviewId: string,
  selectedComments: ReviewComment[],
  client: CodeHostClient,
  repoRef: string,
  mrRef: string,
): Promise<void> {
  const hasCritical = selectedComments.some((c) => c.severity === "critical");
  const event = hasCritical ? "request_changes" : "comment";
  const summary = `AI Code Review: ${selectedComments.length} comments (${hasCritical ? "changes requested" : "reviewed"})`;

  await client.submitReview(repoRef, mrRef, summary, selectedComments, event);

  await supabaseAdmin
    .from("chainthings_code_reviews")
    .update({
      review_status: "submitted",
      review_comments: selectedComments,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", reviewId);
}
