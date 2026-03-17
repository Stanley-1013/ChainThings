import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("chainthings_integrations")
    .select("id, service, label, config, enabled, created_at, updated_at")
    .eq("tenant_id", profile.tenant_id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Integrations API error:", error.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Redact secret fields from config before returning to client
  const SECRET_KEYS = ["api_key", "api_token", "secret", "password"];
  const safeData = (data || []).map((row: Record<string, unknown>) => {
    const config = row.config as Record<string, unknown> | null;
    if (!config) return row;
    const redacted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(config)) {
      if (SECRET_KEYS.includes(k) && typeof v === "string" && v.length > 0) {
        redacted[k] = "••••••••";
      } else {
        redacted[k] = v;
      }
    }
    return { ...row, config: redacted };
  });

  return NextResponse.json({ data: safeData });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { service, label, config } = body as { service?: string; label?: string; config?: unknown };

  if (!service) {
    return NextResponse.json(
      { error: "service is required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("chainthings_integrations")
    .upsert(
      {
        tenant_id: profile.tenant_id,
        service,
        label: label || service,
        config: config || {},
        enabled: true,
      },
      { onConflict: "tenant_id,service" }
    )
    .select()
    .single();

  if (error) {
    console.error("Integrations API error:", error.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, config } = body as { id?: string; config?: unknown };

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  if (config !== undefined && (typeof config !== "object" || config === null || Array.isArray(config))) {
    return NextResponse.json({ error: "config must be a plain object" }, { status: 400 });
  }

  // Fetch existing to merge config
  const { data: existing } = await supabase
    .from("chainthings_integrations")
    .select("config")
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (!existing) {
    return NextResponse.json(
      { error: "Integration not found" },
      { status: 404 }
    );
  }

  const mergedConfig = { ...(existing.config as Record<string, unknown>), ...config };

  const { data, error } = await supabase
    .from("chainthings_integrations")
    .update({ config: mergedConfig, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .select()
    .single();

  if (error) {
    console.error("Integrations API error:", error.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  let delBody: Record<string, unknown>;
  try {
    delBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id } = delBody as { id?: string };

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("chainthings_integrations")
    .delete()
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);

  if (error) {
    console.error("Integrations API error:", error.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
