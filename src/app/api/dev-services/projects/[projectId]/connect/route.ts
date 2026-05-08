import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { encryptSecretConfig } from "@/lib/dev-services/crypto";
import type {
  DevServicePublicConfig,
  DevServiceSecretConfig,
  ServiceCapability,
} from "@/lib/dev-services/types";
import { NextResponse } from "next/server";

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_SERVICES = ["github", "gitlab", "jira"] as const;
type SupportedService = (typeof VALID_SERVICES)[number];

const CAPABILITIES: Record<SupportedService, ServiceCapability[]> = {
  github: ["code_review", "issues", "test_gen", "summary", "branches"],
  gitlab: ["code_review", "issues", "test_gen", "summary", "branches"],
  jira: ["issues", "summary", "transitions"],
};

// ── POST /api/dev-services/projects/[projectId]/connect ──────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { tenantId } = { tenantId: profile.tenant_id };

  // ── Verify project belongs to tenant ─────────────────────────────────────
  const { data: project } = await supabase
    .from("chainthings_dev_projects")
    .select("id")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .single();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    service,
    label,
    jira_domain,
    jira_email,
    api_token,
    access_token,
    auto_review_enabled,
    auto_review_repos,
    review_language,
    jira_projects,
    status_mapping,
  } = body as {
    service?: string;
    label?: string;
    jira_domain?: string;
    jira_email?: string;
    api_token?: string;
    access_token?: string;
    auto_review_enabled?: boolean;
    auto_review_repos?: string[];
    review_language?: string;
    jira_projects?: string[];
    status_mapping?: { mr_opened?: string; mr_merged?: string };
  };

  // Validate status_mapping if provided
  if (status_mapping !== undefined) {
    if (status_mapping === null || typeof status_mapping !== "object" || Array.isArray(status_mapping)) {
      return NextResponse.json({ error: "status_mapping must be an object" }, { status: 400 });
    }
    if (
      status_mapping.mr_opened !== undefined &&
      (typeof status_mapping.mr_opened !== "string" || status_mapping.mr_opened.length > 100)
    ) {
      return NextResponse.json({ error: "status_mapping.mr_opened must be a string of at most 100 characters" }, { status: 400 });
    }
    if (
      status_mapping.mr_merged !== undefined &&
      (typeof status_mapping.mr_merged !== "string" || status_mapping.mr_merged.length > 100)
    ) {
      return NextResponse.json({ error: "status_mapping.mr_merged must be a string of at most 100 characters" }, { status: 400 });
    }
  }

  // Validate jira_projects format: each key must match Jira's key format
  if (jira_projects !== undefined) {
    const jiraKeyPattern = /^[A-Z][A-Z0-9_]{1,9}$/;
    const invalidKey = (jira_projects as unknown[]).find(
      (k) => typeof k !== "string" || !jiraKeyPattern.test(k),
    );
    if (invalidKey !== undefined) {
      return NextResponse.json(
        { error: "jira_projects entries must match /^[A-Z][A-Z0-9_]{1,9}$/" },
        { status: 400 },
      );
    }
  }

  // ── Validate service ──────────────────────────────────────────────────────
  if (!service || !(VALID_SERVICES as readonly string[]).includes(service)) {
    return NextResponse.json(
      { error: `service must be one of: ${VALID_SERVICES.join(", ")}` },
      { status: 400 },
    );
  }
  const svc = service as SupportedService;

  // ── Build PublicConfig ────────────────────────────────────────────────────
  const publicConfig: DevServicePublicConfig = {
    auth_type: "api_token",
    auto_review_enabled: auto_review_enabled ?? false,
    auto_review_repos: auto_review_repos ?? [],
    review_language: review_language ?? "en",
  };

  if (svc === "jira") {
    if (!jira_domain || !jira_email || !api_token) {
      return NextResponse.json(
        { error: "jira_domain, jira_email, and api_token are required for Jira" },
        { status: 400 },
      );
    }
    const resolvedStatusMapping: { mr_opened?: string; mr_merged?: string } = {};
    if (status_mapping?.mr_opened) resolvedStatusMapping.mr_opened = status_mapping.mr_opened;
    if (status_mapping?.mr_merged) resolvedStatusMapping.mr_merged = status_mapping.mr_merged;

    publicConfig.jira = {
      domain: jira_domain,
      email: jira_email,
      projects: jira_projects ?? [],
      status_mapping: resolvedStatusMapping,
    };
  }

  // ── Build SecretConfig ────────────────────────────────────────────────────
  const secretConfig: DevServiceSecretConfig = {
    access_token: access_token ?? "",
  };

  if (svc === "jira") {
    secretConfig.api_token = api_token;
  }

  // ── Validate credentials presence ────────────────────────────────────────
  if (svc !== "jira" && !access_token) {
    return NextResponse.json({ error: "access_token is required" }, { status: 400 });
  }

  // ── Fetch authenticated user from the service ─────────────────────────────
  let externalUserId: string;
  let externalAvatarUrl: string | null = null;

  try {
    if (svc === "github") {
      const { GitHubClient } = await import("@/lib/dev-services/adapters/github");
      const ghClient = new GitHubClient(access_token!);
      const serviceUser = await ghClient.getAuthenticatedUser();
      externalUserId = serviceUser.id;
      externalAvatarUrl = serviceUser.avatarUrl ?? null;
    } else if (svc === "jira") {
      const { JiraClient } = await import("@/lib/dev-services/adapters/jira");
      const jiraClient = new JiraClient(jira_domain!, jira_email!, api_token!);
      const serviceUser = await jiraClient.getAuthenticatedUser();
      externalUserId = serviceUser.id;
      externalAvatarUrl = serviceUser.avatarUrl ?? null;
    } else if (svc === "gitlab") {
      const { GitLabClient } = await import("@/lib/dev-services/adapters/gitlab");
      const glClient = new GitLabClient(access_token!);
      const serviceUser = await glClient.getAuthenticatedUser();
      externalUserId = serviceUser.id;
      externalAvatarUrl = serviceUser.avatarUrl ?? null;
    } else {
      externalUserId = "unknown";
      externalAvatarUrl = null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Credential check failed";
    console.error(`[connect] getAuthenticatedUser failed for ${svc}:`, err);
    return NextResponse.json(
      { error: `Invalid credentials: ${message}` },
      { status: 400 },
    );
  }

  // Only write to DB after credentials are validated
  publicConfig.external_user_id = externalUserId;
  publicConfig.external_avatar_url = externalAvatarUrl ?? undefined;

  // ── Encrypt secret config ─────────────────────────────────────────────────
  const encryptedSecret = encryptSecretConfig(secretConfig);

  // ── Generate webhook secret ───────────────────────────────────────────────
  const webhookSecret = crypto.randomUUID();

  // ── Upsert into chainthings_integrations (select-then-update-or-insert) ──
  // Cannot use PostgREST upsert because the unique index is partial
  // (WHERE dev_project_id IS NOT NULL), which PostgREST cannot match.
  const capabilities = CAPABILITIES[svc];

  const integrationPayload = {
    tenant_id: tenantId,
    dev_project_id: projectId,
    service: svc,
    label: label ?? svc,
    config: publicConfig,
    secret_config: encryptedSecret,
    status: "active" as const,
    capabilities,
    webhook_secret: webhookSecret,
    enabled: true,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await supabaseAdmin
    .from("chainthings_integrations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("dev_project_id", projectId)
    .eq("service", svc)
    .maybeSingle();

  if (existing) {
    const { error: updateError } = await supabaseAdmin
      .from("chainthings_integrations")
      .update(integrationPayload)
      .eq("id", existing.id);

    if (updateError) {
      console.error("Dev Project connect update error:", updateError.message);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  } else {
    const { error: insertError } = await supabaseAdmin
      .from("chainthings_integrations")
      .insert(integrationPayload);

    if (insertError) {
      console.error("Dev Project connect insert error:", insertError.message);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  // Fresh SELECT to get the final row
  const { data: integration, error: fetchError } = await supabaseAdmin
    .from("chainthings_integrations")
    .select("id, service, label, config, capabilities, status")
    .eq("tenant_id", tenantId)
    .eq("dev_project_id", projectId)
    .eq("service", svc)
    .single();

  if (fetchError || !integration) {
    console.error("Dev Project connect fetch error:", fetchError?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  const webhookUrl = `${appUrl}/api/dev-services/webhooks/${svc}/${integration.id}`;

  const cfg = integration.config as DevServicePublicConfig | null;

  return NextResponse.json({
    data: {
      id: integration.id,
      service: integration.service,
      label: integration.label,
      external_user_id: cfg?.external_user_id ?? null,
      capabilities: integration.capabilities,
      status: integration.status,
    },
    webhook_url: webhookUrl,
  });
}
