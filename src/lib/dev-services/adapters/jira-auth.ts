import type {
  CredentialStrategy,
  DevServicePublicConfig,
  DevServiceSecretConfig,
  ResolvedCredential,
} from "../types";

export class JiraApiTokenStrategy implements CredentialStrategy {
  readonly authType = "api_token" as const;

  requiresOAuth(): boolean {
    return false;
  }

  async resolveCredential(
    secretConfig: DevServiceSecretConfig,
    publicConfig: DevServicePublicConfig,
  ): Promise<ResolvedCredential> {
    const token = secretConfig.api_token;
    if (!token) throw new Error("Jira API token not configured");
    const email = publicConfig.jira?.email;
    if (!email) throw new Error("Jira email not configured");
    // Return the raw API token — JiraClient constructor builds
    // the Basic auth header as base64(email:apiToken).
    return { token };
  }

  async refreshIfNeeded(): Promise<ResolvedCredential | null> {
    // API tokens don't expire
    return null;
  }
}
