import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

const LINKS_LIMIT = 200;

// ── GET /api/dev-services/projects/[projectId]/links ─────────────────────────

export async function GET(
  _request: Request,
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

  const tenantId: string = profile.tenant_id;

  // ── Verify project belongs to tenant ─────────────────────────────────────
  const { data: project } = await supabase
    .from("chainthings_dev_projects")
    .select("id")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .single();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // ── Fetch service links scoped to this project ────────────────────────────
  const { data: rows, error } = await supabaseAdmin
    .from("chainthings_service_links")
    .select(
      "id, source_service, source_type, source_ref, source_url, target_service, target_type, target_ref, target_url, link_type, status, created_at",
    )
    .eq("tenant_id", tenantId)
    .eq("dev_project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(LINKS_LIMIT);

  if (error) {
    console.error("[links] fetch error:", error.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const data = (rows ?? []).map((r) => ({
    id: r.id as string,
    sourceService: r.source_service as string,
    sourceType: r.source_type as string,
    sourceRef: r.source_ref as string,
    sourceUrl: (r.source_url as string | null) ?? null,
    targetService: r.target_service as string,
    targetType: r.target_type as string,
    targetRef: r.target_ref as string,
    targetUrl: (r.target_url as string | null) ?? null,
    linkType: r.link_type as string,
    status: r.status as string,
    createdAt: r.created_at as string,
  }));

  return NextResponse.json({ data });
}
