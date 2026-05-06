import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCredentialStrategy } from "@/lib/dev-services/credential-registry";
import { encryptSecretConfig } from "@/lib/dev-services/crypto";
import type { DevServiceSecretConfig } from "@/lib/dev-services/types";
import { publicOrigin, publicUrl } from "@/lib/request-url";
import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const STATE_COOKIE = "ds_oauth_state";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ service: string }> },
) {
  const { service } = await params;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  if (!code || !stateParam) {
    return NextResponse.redirect(publicUrl(request, "/settings?error=missing_params"));
  }

  // Verify state
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  if (!stateCookie || stateCookie !== stateParam) {
    return NextResponse.redirect(publicUrl(request, "/settings?error=invalid_state"));
  }

  const parts = stateParam.split(":");
  if (parts.length !== 4) {
    return NextResponse.redirect(publicUrl(request, "/settings?error=malformed_state"));
  }

  const [tenantId, stateService, _nonce, sig] = parts;
  if (stateService !== service) {
    return NextResponse.redirect(publicUrl(request, "/settings?error=service_mismatch"));
  }

  // Verify HMAC
  const secret = process.env.CHAINTHINGS_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) {
    return NextResponse.redirect(publicUrl(request, "/settings?error=server_misconfiguration"));
  }
  const payload = `${tenantId}:${stateService}:${_nonce}`;
  const expectedSig = createHmac("sha256", secret).update(payload).digest("hex");
  if (sig !== expectedSig) {
    return NextResponse.redirect(publicUrl(request, "/settings?error=invalid_signature"));
  }

  // Exchange code for token
  const strategy = getCredentialStrategy(service);
  if (!strategy?.exchangeCodeForToken) {
    return NextResponse.redirect(publicUrl(request, "/settings?error=unsupported"));
  }

  try {
    const tokenResult = await strategy.exchangeCodeForToken(code);

    // Encrypt secrets
    const secretConfig: DevServiceSecretConfig = {
      access_token: tokenResult.access_token,
      refresh_token: tokenResult.refresh_token,
    };
    const encrypted = encryptSecretConfig(secretConfig);

    // Get user info from service (GitHub only supports OAuth)
    const { GitHubClient } = await import("@/lib/dev-services/adapters/github");
    const tempClient = new GitHubClient(tokenResult.access_token);
    const serviceUser = await tempClient.getAuthenticatedUser();

    // Determine capabilities
    const capabilities = service === "github"
      ? ["code_review", "issues", "test_gen", "summary", "branches"]
      : ["issues", "summary"];

    // Build config — external user info is stored inside config JSONB only
    const config = {
      auth_type: "oauth2",
      external_user_id: serviceUser.login,
      external_avatar_url: serviceUser.avatarUrl,
      token_expires_at: tokenResult.expires_in
        ? new Date(Date.now() + tokenResult.expires_in * 1000).toISOString()
        : undefined,
      scopes: tokenResult.scope?.split(",") ?? [],
      auto_review_enabled: false,
      auto_review_repos: [],
      review_language: "en",
    };

    // Select-then-update-or-insert for dev_project_id = null tenant-level integration
    // (PostgREST upsert cannot match partial unique indexes where dev_project_id IS NULL)
    const { data: existing } = await supabaseAdmin
      .from("chainthings_integrations")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("service", service)
      .is("dev_project_id", null)
      .maybeSingle();

    const integrationPayload = {
      tenant_id: tenantId,
      dev_project_id: null,
      service,
      label: `${service} (${serviceUser.login})`,
      config,
      secret_config: encrypted,
      status: "active",
      capabilities,
      enabled: true,
      webhook_secret: crypto.randomUUID(),
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const { error: updateError } = await supabaseAdmin
        .from("chainthings_integrations")
        .update(integrationPayload)
        .eq("id", existing.id);

      if (updateError) {
        console.error(`OAuth callback update error for ${service}:`, updateError.message);
        return NextResponse.redirect(publicUrl(request, "/settings?error=db_error"));
      }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from("chainthings_integrations")
        .insert(integrationPayload);

      if (insertError) {
        console.error(`OAuth callback insert error for ${service}:`, insertError.message);
        return NextResponse.redirect(publicUrl(request, "/settings?error=db_error"));
      }
    }

    // Fallback to current request URL base if NEXT_PUBLIC_APP_URL is not set
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? publicOrigin(request);

    return NextResponse.redirect(
      `${appUrl}/settings?tab=integrations&service=${service}&status=connected`,
    );
  } catch (err) {
    console.error(`OAuth callback failed for ${service}:`, err);
    return NextResponse.redirect(publicUrl(request, "/settings?error=token_exchange_failed"));
  }
}
