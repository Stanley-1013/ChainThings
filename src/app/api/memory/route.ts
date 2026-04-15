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

  const body = await request.json();
  const ids: string[] = body.ids ?? (body.id ? [body.id] : []);
  if (ids.length === 0) {
    return NextResponse.json({ error: "id or ids is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if ("due_date" in body) {
    if (
      body.due_date !== null &&
      (typeof body.due_date !== "string" || Number.isNaN(new Date(body.due_date).getTime()))
    ) {
      return NextResponse.json(
        { error: "due_date must be a valid ISO 8601 date string or null" },
        { status: 400 }
      );
    }
    updates.due_date = body.due_date;
  }
  if ("assignee" in body) {
    updates.assignee = typeof body.assignee === "string" ? body.assignee : null;
  }
  if ("task_status" in body) {
    const validStatuses = ["todo", "in_progress", "done"];
    if (!validStatuses.includes(body.task_status)) {
      return NextResponse.json(
        { error: `task_status must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }
    updates.task_status = body.task_status;
  }
  if ("importance" in body) {
    const imp = Number(body.importance);
    if (!Number.isFinite(imp) || imp < 1 || imp > 10) {
      return NextResponse.json({ error: "importance must be 1-10" }, { status: 400 });
    }
    updates.importance = imp;
  }

  const { data, error } = await supabase
    .from("chainthings_memory_entries")
    .update(updates)
    .in("id", ids)
    .eq("tenant_id", profile.tenant_id)
    .eq("status", "active")
    .select("*");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [], updated: data?.length ?? 0 });
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

  const body = await request.json();

  if (body.clearAll) {
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

  const ids: string[] = body.ids ?? (body.id ? [body.id] : []);
  if (ids.length === 0) {
    return NextResponse.json({ error: "id, ids, or clearAll is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("chainthings_memory_entries")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .in("id", ids)
    .eq("tenant_id", profile.tenant_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: { archived: ids.length } });
}
