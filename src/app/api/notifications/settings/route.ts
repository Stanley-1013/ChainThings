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
  if (!profile?.tenant_id) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("chainthings_notification_settings")
    .select("*")
    .eq("tenant_id", profile.tenant_id)
    .eq("user_id", user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return defaults if no settings exist
  return NextResponse.json({
    data: data ?? {
      enabled: false,
      frequency: "weekly",
      timezone: "Asia/Taipei",
      send_hour_local: 9,
    },
  });
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
  if (!profile?.tenant_id) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const body = await request.json();
  const { enabled, frequency, timezone, send_hour_local } = body;

  const validFrequencies = ["daily", "every3days", "weekly", "biweekly"];
  if (frequency && !validFrequencies.includes(frequency)) {
    return NextResponse.json(
      { error: `Invalid frequency. Must be one of: ${validFrequencies.join(", ")}` },
      { status: 400 }
    );
  }

  if (send_hour_local !== undefined) {
    const hour = Number(send_hour_local);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return NextResponse.json(
        { error: "send_hour_local must be an integer between 0 and 23" },
        { status: 400 }
      );
    }
  }

  if (timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    } catch {
      return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("chainthings_notification_settings")
    .upsert(
      {
        tenant_id: profile.tenant_id,
        user_id: user.id,
        enabled: enabled ?? false,
        frequency: frequency ?? "weekly",
        timezone: timezone ?? "Asia/Taipei",
        send_hour_local: send_hour_local ?? 9,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,user_id" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
