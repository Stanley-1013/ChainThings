import type {
  CredentialStrategy,
  DevServicePublicConfig,
  DevServiceSecretConfig,
  ResolvedCredential,
  TokenResult,
} from "../types";

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

export class GitHubOAuthStrategy implements CredentialStrategy {
  readonly authType = "oauth2" as const;

  requiresOAuth(): boolean {
    return true;
  }

  getAuthorizationUrl(state: string): string {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) throw new Error("GITHUB_CLIENT_ID not set");
    const params = new URLSearchParams({
      client_id: clientId,
      state,
      scope: "repo read:org read:user",
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/dev-services/github/callback`,
    });
    return `${GITHUB_AUTH_URL}?${params}`;
  }

  async exchangeCodeForToken(code: string): Promise<TokenResult> {
    const res = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    if (!res.ok) throw new Error(`GitHub token exchange failed: ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    if (data.error) throw new Error(`GitHub OAuth error: ${data.error}`);
    return {
      access_token: data.access_token as string,
      refresh_token: data.refresh_token as string | undefined,
      expires_in: data.expires_in as number | undefined,
      scope: data.scope as string | undefined,
    };
  }

  async resolveCredential(
    secretConfig: DevServiceSecretConfig,
    _publicConfig: DevServicePublicConfig,
  ): Promise<ResolvedCredential> {
    return {
      token: secretConfig.access_token,
      expiresAt: _publicConfig.token_expires_at
        ? new Date(_publicConfig.token_expires_at)
        : undefined,
    };
  }

  async refreshIfNeeded(
    current: ResolvedCredential,
  ): Promise<ResolvedCredential | null> {
    if (!current.expiresAt) return null;
    const fiveMinutes = 5 * 60 * 1000;
    if (current.expiresAt.getTime() - Date.now() > fiveMinutes) return null;
    // GitHub OAuth tokens from basic OAuth apps don't expire.
    // GitHub App installation tokens do, but refresh requires app JWT.
    // For now, return null to signal re-auth is needed.
    return null;
  }
}
