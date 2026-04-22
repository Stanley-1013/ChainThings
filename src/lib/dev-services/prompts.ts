import { supabaseAdmin } from "@/lib/supabase/admin";
import type { DevServicePublicConfig } from "./types";
import { getAvailableWorkflows } from "./orchestration/workflow-engine";

export interface DevProject {
  id: string;
  name: string;
  description: string | null;
  context_notes: string | null;
  default_repo_ref: string | null;
  default_jira_project: string | null;
}

export function buildDevSystemPrompt(
  connectedServices: Array<{ service: string; capabilities: string[]; config: DevServicePublicConfig }>,
  project?: DevProject,
): string {
  const serviceList = connectedServices
    .map((s) => `- ${s.service}: capabilities=[${s.capabilities.join(",")}]`)
    .join("\n");

  const workflows = getAvailableWorkflows()
    .filter((w) => w.requiredServices.every((req) =>
      req.split("|").some((alt) => connectedServices.some((s) => s.service === alt)),
    ))
    .map((w) => `- ${w.name}: ${w.description} (requires: ${w.requiredServices.join(", ")})`)
    .join("\n");

  const jiraProjects = connectedServices
    .find((s) => s.service === "jira")
    ?.config.jira?.projects?.join(", ") ?? "none";

  const projectContext = project
    ? `\nYou are working in project '${project.name}'.${project.default_repo_ref ? ` Default repo: ${project.default_repo_ref}.` : ""}${project.default_jira_project ? ` Default Jira project: ${project.default_jira_project}.` : ""}${project.context_notes ? ` Context: ${project.context_notes}` : ""}${project.description ? `\nProject description: ${project.description}` : ""}`
    : "";

  return `You are a project management and development assistant with access to the user's connected dev services.${projectContext}

Connected services:
${serviceList || "No services connected."}

Available workflows:
${workflows || "None (connect services to enable workflows)."}

Jira projects: ${jiraProjects}

You can propose actions using \`\`\`dev-action code blocks:

1. Single-service actions:
\`\`\`dev-action
{"action": "list_issues", "service": "jira", "params": {"projectRef": "PROJ"}}
\`\`\`

2. Cross-service workflows:
\`\`\`dev-action
{"workflow": "create_feature", "params": {"title": "Login refactor", "type": "Story", "project": "PROJ", "repo": "owner/repo", "codeService": "github", "slug": "login-refactor"}}
\`\`\`

3. Code review (generates draft, user confirms before submitting):
\`\`\`dev-action
{"action": "review_mr", "service": "github", "params": {"repoRef": "owner/repo", "mrRef": "42"}}
\`\`\`

4. Test generation:
\`\`\`dev-action
{"action": "generate_tests", "service": "github", "params": {"repoRef": "owner/repo", "mrRef": "42"}}
\`\`\`

5. Sprint summary:
\`\`\`dev-action
{"action": "list_issues", "service": "jira", "params": {"projectRef": "PROJ"}}
\`\`\`

Rules:
- NEVER execute actions directly. Always propose and explain what will happen.
- For cross-service workflows, explain each step before proposing.
- Read-only actions (list_issues, list_repos, get_mr) can be proposed without explanation.
- Destructive actions (create_issue, review_mr, submit_review, execute_workflow) need clear explanation.
- Use the user's language for explanations.`;
}

export interface ParsedDevAction {
  type: "action" | "workflow";
  action?: string;
  workflow?: string;
  service?: string;
  params: Record<string, unknown>;
}

export function parseDevActions(content: string): ParsedDevAction[] {
  const pattern = /```dev-action\s*([\s\S]*?)```/g;
  const actions: ParsedDevAction[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    try {
      const raw = JSON.parse(match[1].trim()) as Record<string, unknown>;
      if (raw.workflow) {
        actions.push({
          type: "workflow",
          workflow: raw.workflow as string,
          params: (raw.params as Record<string, unknown>) ?? {},
        });
      } else if (raw.action) {
        actions.push({
          type: "action",
          action: raw.action as string,
          service: raw.service as string | undefined,
          params: (raw.params as Record<string, unknown>) ?? {},
        });
      }
    } catch {
      // Skip malformed dev-action blocks
    }
  }

  return actions;
}

export async function getConnectedServicesForProject(tenantId: string, projectId: string) {
  const { data } = await supabaseAdmin
    .from("chainthings_integrations")
    .select("service, config, capabilities, status")
    .eq("tenant_id", tenantId)
    .eq("dev_project_id", projectId)
    .eq("status", "active")
    .in("service", ["github", "gitlab", "jira"]);

  return (data ?? []).map((i) => ({
    service: i.service as string,
    capabilities: (i.capabilities as string[]) ?? [],
    config: i.config as DevServicePublicConfig,
  }));
}

export async function listDevProjects(tenantId: string): Promise<DevProject[]> {
  const { data } = await supabaseAdmin
    .from("chainthings_dev_projects")
    .select("id, name, description, context_notes, default_repo_ref, default_jira_project")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  return (data ?? []) as DevProject[];
}

/**
 * Backward-compat: returns all active dev-service integrations for a tenant
 * regardless of dev project. Used by the generic chat route where no project
 * has been selected.
 */
export async function getConnectedServices(tenantId: string) {
  const { data } = await supabaseAdmin
    .from("chainthings_integrations")
    .select("service, config, capabilities, status")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .in("service", ["github", "gitlab", "jira"]);

  return (data ?? []).map((i) => ({
    service: i.service as string,
    capabilities: (i.capabilities as string[]) ?? [],
    config: i.config as DevServicePublicConfig,
  }));
}
