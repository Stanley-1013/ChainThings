import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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
  if (!profile?.tenant_id) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const { type, title, content, metadata } = await request.json();
  if (!type) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("chainthings_items")
    .insert({
      tenant_id: profile.tenant_id,
      type,
      title: title ?? null,
      content: content ?? null,
      metadata: metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}

export async function GET(request: Request) {
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
  if (!profile?.tenant_id) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;
  const type = searchParams.get("type");
  const pageParam = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "20", 10);
  const sort = searchParams.get("sort") ?? "created_at";
  const order = searchParams.get("order") ?? "desc";

  const page = Number.isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
  const limit = Number.isNaN(limitParam) || limitParam < 1 ? 20 : limitParam;

  let query = supabase
    .from("chainthings_items")
    .select("*", { count: "exact" })
    .eq("tenant_id", profile.tenant_id);

  if (type) {
    query = query.eq("type", type);
  }

  const { data, count, error } = await query
    .order(sort, { ascending: order === "asc" })
    .range((page - 1) * limit, page * limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    data: data ?? [],
    pagination: { page, limit, total: count ?? 0 },
  });
}
