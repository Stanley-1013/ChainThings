import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HedyClient, HedyApiError } from "@/lib/integrations/hedy/client";
import { NextResponse } from "next/server";

/**
 * Smoke test: verify the tenant's stored Hedy API key works by calling GET /me.
 * Does not mutate any state. Safe to call repeatedly.
 */
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

  const { data: integration } = await supabaseAdmin
    .from("chainthings_integrations")
    .select("config")
    .eq("tenant_id", profile.tenant_id)
    .eq("service", "hedy.ai")
    .single();

  const apiKey = integration?.config?.api_key;
  if (typeof apiKey !== "string" || apiKey.length === 0 || apiKey.includes("•")) {
    return NextResponse.json(
      { ok: false, error: "No Hedy API key configured" },
      { status: 400 },
    );
  }

  const client = new HedyClient({ apiKey });
  try {
    const me = await client.getMe();
    return NextResponse.json({
      ok: true,
      user: {
        id: me.id,
        email: me.email ?? null,
        name: me.name ?? null,
        pro: me.pro ?? null,
        cloudSyncEnabled: me.cloudSyncEnabled ?? null,
      },
    });
  } catch (err) {
    if (err instanceof HedyApiError) {
      return NextResponse.json(
        { ok: false, error: err.message, status: err.status },
        { status: err.status === 401 ? 400 : 502 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
