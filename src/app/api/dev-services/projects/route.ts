import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getAuthContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, tenantId: null };

  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  return {
    supabase,
    user,
    tenantId: profile?.tenant_id ?? null,
  };
}

// ── GET /api/dev-services/projects ──────────────────────────────────────────

export async function GET() {
  const { supabase, user, tenantId } = await getAuthContext();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { data: projects, error } = await supabase
    .from("chainthings_dev_projects")
    .select(
      "id, name, description, context_notes, default_repo_ref, default_jira_project, metadata, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Dev Projects GET error:", error.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Attach integrations for each project (no secrets)
  const projectIds = (projects ?? []).map((p) => p.id);
  let integrationsByProject: Record<
    string,
    Array<{ service: string; label: string; status: string; external_user_id: string | null }>
  > = {};

  if (projectIds.length > 0) {
    const { data: integrations, error: intErr } = await supabase
      .from("chainthings_integrations")
      .select("dev_project_id, service, label, status, config")
      .eq("tenant_id", tenantId)
      .in("dev_project_id", projectIds);

    if (intErr) {
      console.error("Dev Projects integrations fetch error:", intErr.message);
    } else {
      for (const row of integrations ?? []) {
        if (!row.dev_project_id) continue;
        if (!integrationsByProject[row.dev_project_id]) {
          integrationsByProject[row.dev_project_id] = [];
        }
        const cfg = row.config as { external_user_id?: string | null } | null;
        integrationsByProject[row.dev_project_id].push({
          service: row.service,
          label: row.label,
          status: row.status,
          external_user_id: cfg?.external_user_id ?? null,
        });
      }
    }
  }

  const data = (projects ?? []).map((p) => ({
    ...p,
    integrations: integrationsByProject[p.id] ?? [],
  }));

  return NextResponse.json({ data });
}

// ── POST /api/dev-services/projects ─────────────────────────────────────────

export async function POST(request: Request) {
  const { supabase, user, tenantId } = await getAuthContext();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    name,
    description,
    context_notes,
    default_repo_ref,
    default_jira_project,
    metadata,
  } = body as {
    name?: string;
    description?: string;
    context_notes?: string;
    default_repo_ref?: string;
    default_jira_project?: string;
    metadata?: unknown;
  };

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (name.trim().length > 100) {
    return NextResponse.json({ error: "name must be 100 characters or fewer" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("chainthings_dev_projects")
    .insert({
      tenant_id: tenantId,
      name: name.trim(),
      description: description ?? null,
      context_notes: context_notes ?? null,
      default_repo_ref: default_repo_ref ?? null,
      default_jira_project: default_jira_project ?? null,
      metadata: metadata ?? {},
    })
    .select(
      "id, name, description, context_notes, default_repo_ref, default_jira_project, metadata, created_at, updated_at",
    )
    .single();

  if (error) {
    console.error("Dev Projects POST error:", error.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
