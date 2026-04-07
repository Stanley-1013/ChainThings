import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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
  const category = searchParams.get("category");
  const status = searchParams.get("status") ?? "active";

  let query = supabase
    .from("chainthings_memory_entries")
    .select("*")
    .eq("tenant_id", profile.tenant_id)
    .eq("status", status)
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
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
  if (!profile?.tenant_id) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const { category, content, importance, dueDate } = await request.json();
  if (!category || !content) {
    return NextResponse.json(
      { error: "category and content are required" },
      { status: 400 }
    );
  }

  const validCategories = ["task", "preference", "fact", "project", "summary"];
  if (!validCategories.includes(category)) {
    return NextResponse.json(
      { error: `Invalid category. Must be one of: ${validCategories.join(", ")}` },
      { status: 400 }
    );
  }

  const validDueDate = dueDate && !isNaN(new Date(dueDate).getTime()) ? dueDate : null;

  const { data, error } = await supabase
    .from("chainthings_memory_entries")
    .insert({
      tenant_id: profile.tenant_id,
      category,
      content,
      importance: importance ?? 5,
      source_type: "manual",
      due_date: validDueDate,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}

export async function PATCH(request: Request) {
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

  const { id, due_date } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  if (
    due_date !== null &&
    (typeof due_date !== "string" || Number.isNaN(new Date(due_date).getTime()))
  ) {
    return NextResponse.json(
      { error: "due_date must be a valid ISO 8601 date string or null" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("chainthings_memory_entries")
    .update({
      due_date,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .eq("status", "active")
    .select("*")
    .single();

  if (error) {
    const notFound = error.code === "PGRST116";
    return NextResponse.json(
      { error: notFound ? "Memory entry not found" : error.message },
      { status: notFound ? 404 : 500 }
    );
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
  if (!profile?.tenant_id) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const { id, clearAll } = await request.json();

  if (clearAll) {
    const { error } = await supabase
      .from("chainthings_memory_entries")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("tenant_id", profile.tenant_id)
      .eq("status", "active");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ data: { cleared: true } });
  }

  if (!id) {
    return NextResponse.json({ error: "id or clearAll is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("chainthings_memory_entries")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: { archived: true } });
}
