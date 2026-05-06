import { createClient } from "@/lib/supabase/server";
import { publicUrl } from "@/lib/request-url";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(publicUrl(request, "/login"), { status: 302 });
}
