import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// ── Auth + project ownership helper ──────────────────────────────────────────

async function getAuthContext(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, tenantId: null, project: null };

  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile) return { supabase, user, tenantId: null, project: null };

  const { data: project } = await supabase
    .from("chainthings_dev_projects")
    .select(
      "id, name, description, context_notes, default_repo_ref, default_jira_project, metadata, created_at, updated_at",
    )
    .eq("id", projectId)
    .eq("tenant_id", profile.tenant_id)
    .single();

  return { supabase, user, tenantId: profile.tenant_id, project: project ?? null };
}

// ── GET /api/dev-services/projects/[projectId] ───────────────────────────────

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const { supabase, user, tenantId, project } = await getAuthContext(projectId);

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Fetch integrations for this project (no secrets)
  const { data: rawIntegrations, error: intErr } = await supabase
    .from("chainthings_integrations")
    .select("id, service, label, status, config")
    .eq("tenant_id", tenantId)
    .eq("dev_project_id", projectId);

  if (intErr) {
    console.error("Dev Project GET integrations error:", intErr.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

  const integrations = (rawIntegrations ?? []).map((row) => {
    const cfg = row.config as { external_user_id?: string | null } | null;
    return {
      id: row.id,
      service: row.service,
      label: row.label,
      status: row.status,
      external_user_id: cfg?.external_user_id ?? null,
      webhook_url: `${APP_URL}/api/dev-services/webhooks/${row.service}/${row.id}`,
    };
  });

  return NextResponse.json({
    data: {
      ...project,
      integrations,
    },
  });
}

// ── PATCH /api/dev-services/projects/[projectId] ─────────────────────────────

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const { supabase, user, tenantId, project } = await getAuthContext(projectId);

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const EDITABLE = [
    "name",
    "description",
    "context_notes",
    "default_repo_ref",
    "default_jira_project",
    "metadata",
  ] as const;

  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE) {
    if (key in body) {
      patch[key] = body[key];
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
  }

  // Validate name if provided
  if ("name" in patch) {
    const name = patch.name;
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    }
    if (name.trim().length > 100) {
      return NextResponse.json({ error: "name must be 100 characters or fewer" }, { status: 400 });
    }
    patch.name = name.trim();
  }

  const { data, error } = await supabase
    .from("chainthings_dev_projects")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .select(
      "id, name, description, context_notes, default_repo_ref, default_jira_project, metadata, created_at, updated_at",
    )
    .single();

  if (error) {
    console.error("Dev Project PATCH error:", error.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

// ── DELETE /api/dev-services/projects/[projectId] ────────────────────────────

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const { supabase, user, tenantId, project } = await getAuthContext(projectId);

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { error } = await supabase
    .from("chainthings_dev_projects")
    .delete()
    .eq("id", projectId)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("Dev Project DELETE error:", error.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
