import { createClient } from "@/lib/supabase/server";
import { getCredentialStrategy } from "@/lib/dev-services/credential-registry";
import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const STATE_COOKIE = "ds_oauth_state";
const STATE_TTL_S = 300; // 5 minutes

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ service: string }> },
) {
  const { service } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const strategy = getCredentialStrategy(service);
  if (!strategy || !strategy.requiresOAuth() || !strategy.getAuthorizationUrl) {
    return NextResponse.json({ error: `OAuth not supported for ${service}` }, { status: 400 });
  }

  // Generate state token: tenantId + service + random + HMAC signature
  const nonce = randomBytes(16).toString("hex");
  const payload = `${profile.tenant_id}:${service}:${nonce}`;
  const secret = process.env.CHAINTHINGS_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  const state = `${payload}:${sig}`;

  // Store state in httpOnly cookie
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: STATE_TTL_S,
    path: "/",
  });

  const url = strategy.getAuthorizationUrl(state);
  return NextResponse.json({ url });
}
