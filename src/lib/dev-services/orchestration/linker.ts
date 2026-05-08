import { supabaseAdmin } from "@/lib/supabase/admin";
import { createDevServiceClient } from "../factory";
import type { DevServicePublicConfig } from "../types";
import { escapeRegExp } from "@/lib/utils";

/** Extract Jira ticket refs (e.g., PROJ-123) from text. */
export function extractTicketRefs(text: string, jiraProjects: string[]): string[] {
  if (!jiraProjects.length || !text) return [];
  const escaped = jiraProjects.map(escapeRegExp);
  const pattern = new RegExp(`(${escaped.join("|")})-\\d+`, "gi");
  return [...new Set(text.match(pattern) ?? [])].map((r) => r.toUpperCase());
}

/** Create a cross-service link in the DB. */
export async function createServiceLink(
  tenantId: string,
  source: { service: string; integrationId?: string; type: string; ref: string; url?: string },
  target: { service: string; integrationId?: string; type: string; ref: string; url?: string },
  linkType: string,
  devProjectId?: string | null,
): Promise<string> {
  // Check for existing link to avoid duplicates, scoped by dev_project_id when present.
  let existingQuery = supabaseAdmin
    .from("chainthings_service_links")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("source_service", source.service)
    .eq("source_ref", source.ref)
    .eq("target_service", target.service)
    .eq("target_ref", target.ref);
  if (devProjectId) {
    existingQuery = existingQuery.eq("dev_project_id", devProjectId);
  } else {
    existingQuery = existingQuery.is("dev_project_id", null);
  }
  const { data: existing } = await existingQuery.maybeSingle();

  if (existing) return existing.id;

  const { data, error } = await supabaseAdmin
    .from("chainthings_service_links")
    .insert({
      tenant_id: tenantId,
      source_service: source.service,
      source_integration_id: source.integrationId,
      source_type: source.type,
      source_ref: source.ref,
      source_url: source.url,
      target_service: target.service,
      target_integration_id: target.integrationId,
      target_type: target.type,
      target_ref: target.ref,
      target_url: target.url,
      link_type: linkType,
      status: "active",
      dev_project_id: devProjectId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      // Concurrent insert won the race — fetch the winning row
      let racedQuery = supabaseAdmin
        .from("chainthings_service_links")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("source_service", source.service)
        .eq("source_ref", source.ref)
        .eq("target_service", target.service)
        .eq("target_ref", target.ref);
      if (devProjectId) {
        racedQuery = racedQuery.eq("dev_project_id", devProjectId);
      } else {
        racedQuery = racedQuery.is("dev_project_id", null);
      }
      const { data: racedRow } = await racedQuery.maybeSingle();
      if (racedRow) return racedRow.id;
    }
    throw new Error(`Failed to create service link: ${error.message}`);
  }
  return data.id;
}

/** Find all links for a given resource. */
export async function getLinksForResource(
  tenantId: string,
  service: string,
  ref: string,
): Promise<Array<{ id: string; sourceService: string; sourceRef: string; sourceUrl?: string; targetService: string; targetRef: string; targetUrl?: string; linkType: string; status: string }>> {
  // Search both directions
  const { data: asSource } = await supabaseAdmin
    .from("chainthings_service_links")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("source_service", service)
    .eq("source_ref", ref);

  const { data: asTarget } = await supabaseAdmin
    .from("chainthings_service_links")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("target_service", service)
    .eq("target_ref", ref);

  const all = [...(asSource ?? []), ...(asTarget ?? [])];
  return all.map((l) => ({
    id: l.id,
    sourceService: l.source_service,
    sourceRef: l.source_ref,
    sourceUrl: l.source_url ?? undefined,
    targetService: l.target_service,
    targetRef: l.target_ref,
    targetUrl: l.target_url ?? undefined,
    linkType: l.link_type,
    status: l.status,
  }));
}

/**
 * Transition a Jira ticket to a mapped status.
 * Uses the status_mapping from the Jira integration config.
 * If projectId is provided, looks up the Jira integration scoped to that dev project.
 */
export async function transitionTicket(
  tenantId: string,
  ticketRef: string,
  triggerEvent: "mr_opened" | "mr_merged",
  projectId?: string | null,
): Promise<boolean> {
  // Find the Jira integration for this tenant, scoped by dev project if provided
  let query = supabaseAdmin
    .from("chainthings_integrations")
    .select("id, config")
    .eq("tenant_id", tenantId)
    .eq("service", "jira")
    .eq("status", "active");

  if (projectId) {
    query = query.eq("dev_project_id", projectId);
  }

  const { data: integration } = await query.maybeSingle();

  if (!integration) return false;

  const config = integration.config as DevServicePublicConfig;
  const jira = config.jira;
  if (!jira) return false;

  // Get the target status name from mapping
  const mapping = jira.status_mapping ?? {};
  const targetStatus = triggerEvent === "mr_opened"
    ? (mapping.mr_opened ?? "In Review")
    : (mapping.mr_merged ?? "Done");

  try {
    const client = projectId
      ? await createDevServiceClient(tenantId, projectId, "jira")
      : await createDevServiceClient(tenantId, "", "jira");
    const tracker = client.asWorkItemTracker?.();
    if (!tracker) return false;

    await tracker.updateIssueStatus(jira.projects?.[0] ?? "", ticketRef, targetStatus);
    return true;
  } catch (err) {
    console.error(`Failed to transition ${ticketRef} to ${targetStatus}:`, err);
    return false;
  }
}

/**
 * Process a MR event: extract ticket refs → create links → transition tickets.
 * Looks up dev_project_id from codeIntegrationId and scopes the Jira lookup to that project.
 */
export async function processMREvent(
  tenantId: string,
  codeService: string,
  codeIntegrationId: string,
  mrRef: string,
  mrUrl: string,
  mrTitle: string,
  mrBody: string,
  mrBranch: string,
  event: "mr_opened" | "mr_merged",
): Promise<{ linkedTickets: string[] }> {
  // Look up dev_project_id from the code integration
  const { data: codeIntegration } = await supabaseAdmin
    .from("chainthings_integrations")
    .select("dev_project_id")
    .eq("id", codeIntegrationId)
    .maybeSingle();

  const devProjectId = codeIntegration?.dev_project_id as string | null | undefined;

  // If not tied to a project, skip — integrations must be project-scoped
  if (!devProjectId) return { linkedTickets: [] };

  // Get Jira integration scoped to the same dev project
  const { data: jiraIntegration } = await supabaseAdmin
    .from("chainthings_integrations")
    .select("id, config")
    .eq("tenant_id", tenantId)
    .eq("service", "jira")
    .eq("dev_project_id", devProjectId)
    .eq("status", "active")
    .maybeSingle();

  if (!jiraIntegration) return { linkedTickets: [] };

  const jiraConfig = jiraIntegration.config as DevServicePublicConfig;
  const projects = jiraConfig.jira?.projects ?? [];
  if (projects.length === 0) return { linkedTickets: [] };

  // Extract ticket refs from title + body + branch name
  const searchText = [mrTitle, mrBody, mrBranch].join(" ");
  const ticketRefs = extractTicketRefs(searchText, projects);
  if (ticketRefs.length === 0) return { linkedTickets: [] };

  for (const ref of ticketRefs) {
    // Create link (carry dev_project_id into the link row)
    await createServiceLink(
      tenantId,
      { service: "jira", integrationId: jiraIntegration.id, type: "ticket", ref, url: `${jiraConfig.jira?.domain ? `https://${jiraConfig.jira.domain}.atlassian.net/browse/${ref}` : ""}` },
      { service: codeService, integrationId: codeIntegrationId, type: "merge_request", ref: mrRef, url: mrUrl },
      "ticket_mr",
      devProjectId,
    );

    // Transition ticket (scoped to the same dev project)
    await transitionTicket(tenantId, ref, event, devProjectId);
  }

  return { linkedTickets: ticketRefs };
}
