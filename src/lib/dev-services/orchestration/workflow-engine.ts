import { supabaseAdmin } from "@/lib/supabase/admin";
import { createDevServiceClient } from "../factory";
import { createServiceLink } from "./linker";

interface WorkflowStep {
  id: string;
  service: string;
  action: string;
  params: Record<string, string>;
  dependsOn?: string[];
}

interface Workflow {
  name: string;
  description: string;
  requiredServices: string[];
  steps: WorkflowStep[];
}

export interface WorkflowStepResult {
  id: string;
  status: string;
  result?: unknown;
  error?: string;
}

export interface WorkflowExecution {
  id: string;
  tenant_id: string;
  dev_project_id: string | null;
  idempotency_key: string | null;
  workflow_name: string;
  input_params: Record<string, unknown>;
  status: string;
  step_results: WorkflowStepResult[];
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const WORKFLOWS: Record<string, Workflow> = {
  create_feature: {
    name: "Create Feature",
    description: "Create Jira ticket + GitHub/GitLab branch with ticket ref",
    requiredServices: ["jira"],
    steps: [
      {
        id: "ticket",
        service: "jira",
        action: "create_issue",
        params: { projectRef: "{{input.project}}", title: "{{input.title}}", body: "{{input.description}}", issueType: "{{input.type}}" },
      },
      {
        id: "branch",
        service: "{{input.codeService}}",
        action: "create_branch",
        params: { repoRef: "{{input.repo}}", branchName: "feature/{{ticket.ref}}-{{input.slug}}" },
        dependsOn: ["ticket"],
      },
      {
        id: "link",
        service: "_internal",
        action: "create_link",
        params: { sourceService: "jira", sourceRef: "{{ticket.ref}}", sourceUrl: "{{ticket.url}}", targetService: "{{input.codeService}}", targetRef: "{{branch.ref}}", targetUrl: "{{branch.url}}", linkType: "ticket_branch" },
        dependsOn: ["ticket", "branch"],
      },
    ],
  },

  create_pr_with_ticket: {
    name: "Create PR with Ticket Link",
    description: "Create a PR with Jira ticket ref in title and body",
    requiredServices: ["jira"],
    steps: [
      {
        id: "ticket_info",
        service: "jira",
        action: "get_issue",
        params: { projectRef: "{{input.project}}", issueRef: "{{input.ticketRef}}" },
      },
      {
        id: "pr",
        service: "{{input.codeService}}",
        action: "create_mr",
        params: { repoRef: "{{input.repo}}", title: "{{input.ticketRef}}: {{ticket_info.title}}", body: "Resolves [{{input.ticketRef}}]({{ticket_info.url}})", sourceBranch: "{{input.branch}}" },
        dependsOn: ["ticket_info"],
      },
      {
        id: "link",
        service: "_internal",
        action: "create_link",
        params: { sourceService: "jira", sourceRef: "{{input.ticketRef}}", sourceUrl: "{{ticket_info.url}}", targetService: "{{input.codeService}}", targetRef: "{{pr.ref}}", targetUrl: "{{pr.url}}", linkType: "ticket_mr" },
        dependsOn: ["pr"],
      },
    ],
  },

  sprint_summary: {
    name: "Sprint Summary",
    description: "Cross-service sprint progress report",
    requiredServices: ["jira"],
    steps: [
      {
        id: "issues",
        service: "jira",
        action: "list_issues",
        params: { projectRef: "{{input.project}}" },
      },
      {
        id: "summary",
        service: "_ai",
        action: "generate_sprint_summary",
        params: {},
        dependsOn: ["issues"],
      },
    ],
  },
};

type StepContext = Record<string, Record<string, unknown>>;

function resolveTemplate(value: string, ctx: StepContext): string {
  return value.replace(/\{\{(\w+)\.(\w+)\}\}/g, (_match, stepId, field) => {
    const stepResult = ctx[stepId];
    if (!stepResult) return _match;
    return String(stepResult[field] ?? _match);
  });
}

function resolveParams(params: Record<string, string>, ctx: StepContext): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    resolved[k] = resolveTemplate(v, ctx);
  }
  return resolved;
}

export async function executeWorkflow(
  tenantId: string,
  workflowName: string,
  inputParams: Record<string, string>,
  projectId?: string,
  idempotencyKey?: string,
): Promise<{ steps: WorkflowStepResult[] }> {
  const workflow = WORKFLOWS[workflowName];
  if (!workflow) throw new Error(`Unknown workflow: ${workflowName}`);

  // ── Idempotency check ──────────────────────────────────────────────────────
  // TODO(tech-debt): Replace check-then-insert with insert-on-conflict + poll for status=running
  // to prevent duplicate execution when idempotency_key collides at exactly the same moment.
  if (idempotencyKey) {
    const { data: existing } = await supabaseAdmin
      .from("chainthings_workflow_executions")
      .select("step_results, status")
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      // Return cached result — don't re-run
      return { steps: existing.step_results as WorkflowStepResult[] };
    }
  }

  // ── Insert execution row ───────────────────────────────────────────────────
  const { data: execRow, error: insertError } = await supabaseAdmin
    .from("chainthings_workflow_executions")
    .insert({
      tenant_id: tenantId,
      dev_project_id: projectId ?? null,
      idempotency_key: idempotencyKey ?? null,
      workflow_name: workflowName,
      input_params: inputParams,
      status: "running",
      step_results: [],
    })
    .select("id")
    .single();

  if (insertError || !execRow) {
    throw new Error(`Failed to create workflow execution record: ${insertError?.message ?? "unknown"}`);
  }

  const execId = execRow.id;

  // ── Run the workflow steps ─────────────────────────────────────────────────
  const ctx: StepContext = { input: inputParams as unknown as Record<string, unknown> };
  const results: WorkflowStepResult[] = [];

  // Topological sort (simple: just follow dependsOn order)
  const executed = new Set<string>();
  const pending = [...workflow.steps];

  while (pending.length > 0) {
    const ready = pending.filter(
      (s) => !s.dependsOn?.length || s.dependsOn.every((d) => executed.has(d)),
    );
    if (ready.length === 0) {
      // Circular dependency or missing steps
      for (const s of pending) {
        results.push({ id: s.id, status: "skipped", error: "Unresolved dependencies" });
      }
      break;
    }

    for (const step of ready) {
      const resolvedParams = resolveParams(step.params, ctx);
      const resolvedService = resolveTemplate(step.service, ctx);

      try {
        let result: Record<string, unknown>;

        if (resolvedService === "_internal") {
          result = await executeInternalAction(tenantId, step.action, resolvedParams, projectId);
        } else if (resolvedService === "_ai") {
          result = await executeAiAction(tenantId, step.action, resolvedParams, ctx);
        } else {
          result = await executeServiceAction(tenantId, resolvedService, step.action, resolvedParams, projectId);
        }

        ctx[step.id] = result;
        results.push({ id: step.id, status: "completed", result });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        results.push({ id: step.id, status: "failed", error });
        // Don't rollback, just stop dependent steps
      }

      executed.add(step.id);
      pending.splice(pending.indexOf(step), 1);
    }
  }

  // ── Compute final status ───────────────────────────────────────────────────
  const firstFailure = results.find((r) => r.status === "failed");
  const finalStatus = firstFailure ? "failed" : "completed";
  const errorMessage = firstFailure?.error ?? null;

  // ── Update execution row with results ─────────────────────────────────────
  await supabaseAdmin
    .from("chainthings_workflow_executions")
    .update({
      status: finalStatus,
      step_results: results,
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", execId);

  return { steps: results };
}

/** Retrieve a workflow execution row by id, scoped to the tenant. */
export async function getWorkflowExecution(
  tenantId: string,
  id: string,
): Promise<WorkflowExecution | null> {
  const { data } = await supabaseAdmin
    .from("chainthings_workflow_executions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  return data as WorkflowExecution | null;
}

async function executeServiceAction(
  tenantId: string,
  service: string,
  action: string,
  params: Record<string, string>,
  projectId?: string,
): Promise<Record<string, unknown>> {
  const client = await createDevServiceClient(tenantId, projectId ?? "", service);

  switch (action) {
    case "create_issue": {
      const tracker = client.asWorkItemTracker?.();
      if (!tracker) throw new Error(`${service} has no work item tracker`);
      const issue = await tracker.createIssue(params.projectRef, params.title, params.body ?? "", {
        issueType: params.issueType,
      });
      return issue as unknown as Record<string, unknown>;
    }
    case "get_issue": {
      const tracker = client.asWorkItemTracker?.();
      if (!tracker) throw new Error(`${service} has no work item tracker`);
      const issue = await tracker.getIssue(params.projectRef, params.issueRef);
      return issue as unknown as Record<string, unknown>;
    }
    case "create_branch": {
      const host = client.asCodeHost?.();
      if (!host) throw new Error(`${service} has no code host`);
      const branch = await host.createBranch(params.repoRef, params.branchName);
      return branch as unknown as Record<string, unknown>;
    }
    case "create_mr": {
      const host = client.asCodeHost?.();
      if (!host) throw new Error(`${service} has no code host`);
      const mr = await host.createMergeRequest(params.repoRef, params.title, params.body ?? "", params.sourceBranch);
      return mr as unknown as Record<string, unknown>;
    }
    case "list_issues": {
      const tracker = client.asWorkItemTracker?.();
      if (!tracker) throw new Error(`${service} has no work item tracker`);
      const issues = await tracker.listIssues(params.projectRef);
      return { items: issues } as unknown as Record<string, unknown>;
    }
    default:
      throw new Error(`Unknown service action: ${action}`);
  }
}

async function executeInternalAction(
  tenantId: string,
  action: string,
  params: Record<string, string>,
  projectId?: string,
): Promise<Record<string, unknown>> {
  if (action === "create_link") {
    const linkId = await createServiceLink(
      tenantId,
      { service: params.sourceService, type: "ticket", ref: params.sourceRef, url: params.sourceUrl },
      { service: params.targetService, type: params.linkType?.includes("branch") ? "branch" : "merge_request", ref: params.targetRef, url: params.targetUrl },
      params.linkType,
      projectId ?? null,
    );
    return { linkId };
  }
  throw new Error(`Unknown internal action: ${action}`);
}

async function executeAiAction(
  tenantId: string,
  action: string,
  _params: Record<string, string>,
  ctx: StepContext,
): Promise<Record<string, unknown>> {
  if (action === "generate_sprint_summary") {
    const { generateSprintSummary, cacheSummary } = await import("../engines/summary");
    const issuesCtx = ctx.issues as Record<string, unknown> | undefined;
    const items = (issuesCtx?.items as import("../types").Issue[]) ?? [];
    const result = await generateSprintSummary({ issues: items, mergeRequests: [] });
    await cacheSummary(tenantId, result.markdown, "sprint");
    return { markdown: result.markdown };
  }
  throw new Error(`Unknown AI action: ${action}`);
}

export function getAvailableWorkflows(): Array<{ name: string; description: string; requiredServices: string[] }> {
  return Object.entries(WORKFLOWS).map(([key, w]) => ({
    name: key,
    description: w.description,
    requiredServices: w.requiredServices,
  }));
}
