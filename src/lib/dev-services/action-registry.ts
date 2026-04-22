import { z } from "zod";
import type { DevServiceClient, ServiceCapability } from "./types";

export interface ActionDef {
  name: string;
  requiredCapability: ServiceCapability;
  inputSchema: z.ZodSchema;
  requiresApproval: boolean;
  handler: (
    client: DevServiceClient,
    tenantId: string,
    projectId: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
}

// ── Input Schemas ─────────────────────────────────────────

const listReposSchema = z.object({});

const listIssuesSchema = z.object({
  projectRef: z.string().min(1).max(200),
  state: z.string().optional(),
  labels: z.array(z.string().max(100)).max(20).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const createIssueSchema = z.object({
  projectRef: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  body: z.string().max(50000).default(""),
  labels: z.array(z.string().max(100)).max(20).optional(),
  assignee: z.string().max(200).optional(),
  issueType: z.string().max(100).optional(),
  priority: z.string().max(100).optional(),
});

const getMrSchema = z.object({
  repoRef: z.string().min(1).max(200),
  mrRef: z.string().min(1).max(50),
});

const reviewMrSchema = z.object({
  repoRef: z.string().min(1).max(200),
  mrRef: z.string().min(1).max(50),
  language: z.string().max(10).optional(),
});

const genTestsSchema = z.object({
  repoRef: z.string().min(1).max(200),
  filePath: z.string().max(500).optional(),
  mrRef: z.string().max(50).optional(),
});

const submitReviewSchema = z.object({
  reviewId: z.string().uuid(),
  repoRef: z.string().min(1).max(200),
  mrRef: z.string().min(1).max(50),
  selectedComments: z.array(z.object({
    path: z.string().min(1).max(500),
    line: z.number(),
    body: z.string().min(1).max(10000),
    severity: z.enum(["critical", "warning", "suggestion", "praise"]),
    suggestion: z.string().max(10000).optional(),
  })).max(100),
});

const executeWorkflowSchema = z.object({
  workflow: z.string().min(1).max(100),
  params: z.record(z.string().max(200), z.unknown()),
});

// ── Action Handlers ───────────────────────────────────────

const actionRegistry: Record<string, ActionDef> = {
  list_repos: {
    name: "list_repos",
    requiredCapability: "code_review",
    inputSchema: listReposSchema,
    requiresApproval: false,
    handler: async (client, _tenantId, _projectId) => {
      const host = client.asCodeHost?.();
      if (!host) throw new Error("Code host not available");
      return host.listRepos();
    },
  },

  list_issues: {
    name: "list_issues",
    requiredCapability: "issues",
    inputSchema: listIssuesSchema,
    requiresApproval: false,
    handler: async (client, _tenantId, _projectId, params) => {
      const tracker = client.asWorkItemTracker?.();
      if (!tracker) throw new Error("Work item tracker not available");
      return tracker.listIssues(params.projectRef as string, {
        state: params.state as string | undefined,
        labels: params.labels as string[] | undefined,
        limit: params.limit as number | undefined,
      });
    },
  },

  create_issue: {
    name: "create_issue",
    requiredCapability: "issues",
    inputSchema: createIssueSchema,
    requiresApproval: true,
    handler: async (client, _tenantId, _projectId, params) => {
      const tracker = client.asWorkItemTracker?.();
      if (!tracker) throw new Error("Work item tracker not available");
      return tracker.createIssue(
        params.projectRef as string,
        params.title as string,
        params.body as string,
        {
          labels: params.labels as string[] | undefined,
          assignee: params.assignee as string | undefined,
          issueType: params.issueType as string | undefined,
          priority: params.priority as string | undefined,
        },
      );
    },
  },

  get_mr: {
    name: "get_mr",
    requiredCapability: "code_review",
    inputSchema: getMrSchema,
    requiresApproval: false,
    handler: async (client, _tenantId, _projectId, params) => {
      const host = client.asCodeHost?.();
      if (!host) throw new Error("Code host not available");
      return host.getMergeRequest(params.repoRef as string, params.mrRef as string);
    },
  },

  review_mr: {
    name: "review_mr",
    requiredCapability: "code_review",
    inputSchema: reviewMrSchema,
    requiresApproval: true,
    handler: async (client, _tenantId, _projectId, params) => {
      const host = client.asCodeHost?.();
      if (!host) throw new Error("Code host not available");
      const diff = await host.getMergeRequestDiff(
        params.repoRef as string,
        params.mrRef as string,
      );
      const mr = await host.getMergeRequest(
        params.repoRef as string,
        params.mrRef as string,
      );
      const { generateReviewDraft } = await import("./engines/code-review");
      return generateReviewDraft(diff, {
        type: "merge_request",
        ref: mr.ref,
        title: mr.title,
        url: mr.url,
      }, { language: params.language as string | undefined });
    },
  },

  generate_tests: {
    name: "generate_tests",
    requiredCapability: "test_gen",
    inputSchema: genTestsSchema,
    requiresApproval: false,
    handler: async (client, _tenantId, _projectId, params) => {
      const host = client.asCodeHost?.();
      if (!host) throw new Error("Code host not available");
      if (params.mrRef) {
        const diff = await host.getMergeRequestDiff(
          params.repoRef as string,
          params.mrRef as string,
        );
        const { generateTestsFromDiff } = await import("./engines/test-generation");
        return generateTestsFromDiff(diff);
      }
      if (params.filePath) {
        const code = await host.getFileContent(
          params.repoRef as string,
          params.filePath as string,
        );
        const { generateTestsFromCode } = await import("./engines/test-generation");
        return generateTestsFromCode(code, params.filePath as string);
      }
      throw new Error("Either mrRef or filePath is required");
    },
  },

  submit_review: {
    name: "submit_review",
    requiredCapability: "code_review",
    inputSchema: submitReviewSchema,
    requiresApproval: true,
    handler: async (client, _tenantId, _projectId, params) => {
      const host = client.asCodeHost?.();
      if (!host) throw new Error("Code host not available");
      const { submitReview } = await import("./engines/code-review");
      await submitReview(
        params.reviewId as string,
        params.selectedComments as import("./types").ReviewComment[],
        host,
        params.repoRef as string,
        params.mrRef as string,
      );
      return { submitted: true };
    },
  },

  execute_workflow: {
    name: "execute_workflow",
    // Note: requiredCapability is declared but NOT checked at runtime — the actions
    // route short-circuits before client creation for this action (Fix 4).
    // The handler receives null as _client and must not use it.
    requiredCapability: "issues",
    inputSchema: executeWorkflowSchema,
    requiresApproval: true,
    handler: async (_client, tenantId, projectId, params) => {
      const { executeWorkflow } = await import("./orchestration/workflow-engine");
      const { hashParams } = await import("./approval");
      const idempotencyKey = hashParams(params);
      return executeWorkflow(
        tenantId,
        params.workflow as string,
        params.params as Record<string, string>,
        projectId,
        idempotencyKey,
      );
    },
  },
};

export function getAction(name: string): ActionDef | undefined {
  return actionRegistry[name];
}

export function getActionNames(): string[] {
  return Object.keys(actionRegistry);
}

export function validateActionInput(
  name: string,
  input: unknown,
): { success: true; data: Record<string, unknown> } | { success: false; error: string } {
  const action = actionRegistry[name];
  if (!action) return { success: false, error: `Unknown action: ${name}` };
  const result = action.inputSchema.safeParse(input);
  if (!result.success) return { success: false, error: result.error.message };
  return { success: true, data: result.data as Record<string, unknown> };
}
