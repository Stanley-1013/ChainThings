import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
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

  const { conversationId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { title } = body;

  if (typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json(
      { error: "title is required" },
      { status: 400 }
    );
  }

  if (title.trim().length > 200) {
    return NextResponse.json(
      { error: "title must be 200 characters or less" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("chainthings_conversations")
    .update({ title: title.trim() })
    .eq("id", conversationId)
    .eq("tenant_id", profile.tenant_id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("Conversations API error:", error.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
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

  const { conversationId } = await params;

  // Verify conversation belongs to tenant before deleting anything
  const { data: conv } = await supabase
    .from("chainthings_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();

  if (!conv) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  // Messages are deleted via FK cascade (conversation_id references conversations.id)
  const { error } = await supabase
    .from("chainthings_conversations")
    .delete()
    .eq("id", conversationId)
    .eq("tenant_id", profile.tenant_id);

  if (error) {
    console.error("Conversations API error:", error.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
