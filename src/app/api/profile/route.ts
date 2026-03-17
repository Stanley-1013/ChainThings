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

  const { data: profile, error } = await supabase
    .from("chainthings_profiles")
    .select("id, display_name, tenant_id")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      id: profile.id,
      email: user.email,
      display_name: profile.display_name,
      tenant_id: profile.tenant_id,
    },
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { display_name } = body;

  if (typeof display_name !== "string" || display_name.trim().length === 0) {
    return NextResponse.json(
      { error: "display_name is required" },
      { status: 400 }
    );
  }

  if (display_name.trim().length > 100) {
    return NextResponse.json(
      { error: "display_name must be 100 characters or less" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("chainthings_profiles")
    .update({ display_name: display_name.trim() })
    .eq("id", user.id)
    .select("id, display_name, tenant_id")
    .single();

  if (error) {
    console.error("Profile API error:", error.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      id: data.id,
      email: user.email,
      display_name: data.display_name,
      tenant_id: data.tenant_id,
    },
  });
}
