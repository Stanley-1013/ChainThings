import type {
  CredentialStrategy,
  DevServicePublicConfig,
  DevServiceSecretConfig,
  ResolvedCredential,
} from "../types";

export class GitLabPatStrategy implements CredentialStrategy {
  readonly authType = "api_token" as const;

  requiresOAuth(): boolean {
    return false;
  }

  async resolveCredential(
    secretConfig: DevServiceSecretConfig,
    _publicConfig: DevServicePublicConfig,
  ): Promise<ResolvedCredential> {
    const token = secretConfig.access_token;
    if (!token) throw new Error("GitLab Personal Access Token not configured");
    return { token };
  }

  async refreshIfNeeded(): Promise<ResolvedCredential | null> {
    // PATs don't auto-refresh
    return null;
  }
}
