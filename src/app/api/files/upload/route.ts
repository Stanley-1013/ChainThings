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

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const storagePath = `${profile.tenant_id}/${Date.now()}-${file.name}`;

  // Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from("chainthings-uploads")
    .upload(storagePath, file);

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // Save metadata
  const { data: fileMeta, error: metaError } = await supabase
    .from("chainthings_files")
    .insert({
      tenant_id: profile.tenant_id,
      filename: file.name,
      storage_path: storagePath,
      content_type: file.type,
      size_bytes: file.size,
    })
    .select()
    .single();

  if (metaError) {
    return NextResponse.json({ error: metaError.message }, { status: 500 });
  }

  return NextResponse.json({ file: fileMeta });
}
