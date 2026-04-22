import { supabaseAdmin } from "@/lib/supabase/admin";
import { decryptSecretConfig } from "./crypto";
import { getCredentialStrategy } from "./credential-registry";
import { encryptSecretConfig } from "./crypto";
import type {
  DevServiceClient,
  DevServicePublicConfig,
  DevServiceSecretConfig,
} from "./types";
import { AuthExpiredError, DevServiceError } from "./types";

// Adapter imports — add new adapters here
type AdapterFactory = (
  token: string,
  config: DevServicePublicConfig,
) => DevServiceClient;

// Lazy imports to avoid circular dependencies
async function getAdapterFactory(service: string): Promise<AdapterFactory> {
  switch (service) {
    case "github": {
      const { GitHubClient } = await import("./adapters/github");
      return (token, _config) => new GitHubClient(token);
    }
    case "gitlab": {
      const { GitLabClient } = await import("./adapters/gitlab");
      return (token, config) => new GitLabClient(token, config.gitlab?.base_url);
    }
    case "jira": {
      const { JiraClient } = await import("./adapters/jira");
      return (token, config) => {
        const jira = config.jira;
        if (!jira) throw new DevServiceError("jira", "Jira config missing");
        return new JiraClient(jira.domain, jira.email, token);
      };
    }
    default:
      throw new DevServiceError(service, `Unknown service: ${service}`);
  }
}

export async function createDevServiceClient(
  tenantId: string,
  projectId: string,
  service: string,
): Promise<DevServiceClient> {
  const supabase = supabaseAdmin;

  const { data: integration, error } = await supabase
    .from("chainthings_integrations")
    .select("id, config, secret_config, status, capabilities, updated_at")
    .eq("tenant_id", tenantId)
    .eq("dev_project_id", projectId)
    .eq("service", service)
    .single();

  if (error || !integration) {
    throw new DevServiceError(
      service,
      `No ${service} integration found for this tenant`,
    );
  }

  if (integration.status !== "active") {
    throw new AuthExpiredError(service);
  }

  if (!integration.secret_config) {
    throw new DevServiceError(service, "No credentials configured");
  }

  const publicConfig = integration.config as DevServicePublicConfig;
  const secretConfig = decryptSecretConfig(
    Buffer.from(integration.secret_config),
  );

  const strategy = getCredentialStrategy(service);
  if (!strategy) throw new DevServiceError(service, `No credential strategy`);

  let credential = await strategy.resolveCredential(secretConfig, publicConfig);

  // Auto-refresh if needed
  if (strategy.refreshIfNeeded) {
    const refreshed = await strategy.refreshIfNeeded(credential);
    if (refreshed) {
      credential = refreshed;
      // Persist refreshed token with CAS guard on updated_at to prevent
      // concurrent workers from overwriting each other's refresh.
      const originalUpdatedAt = (integration as Record<string, unknown>).updated_at as string | undefined;
      const newSecret: DevServiceSecretConfig = {
        ...secretConfig,
        access_token: refreshed.token,
      };
      const updateQuery = supabase
        .from("chainthings_integrations")
        .update({
          secret_config: encryptSecretConfig(newSecret),
          config: {
            ...publicConfig,
            token_expires_at: refreshed.expiresAt?.toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration.id);

      // Apply CAS guard only when we have a known updated_at
      const { data: casResult } = originalUpdatedAt
        ? await updateQuery.eq("updated_at", originalUpdatedAt).select("id").maybeSingle()
        : await updateQuery.select("id").maybeSingle();

      if (!casResult) {
        // Another worker won the race — re-fetch and use its updated secret_config
        const { data: fresh } = await supabase
          .from("chainthings_integrations")
          .select("secret_config, config")
          .eq("id", integration.id)
          .single();
        if (fresh?.secret_config) {
          const freshSecret = decryptSecretConfig(Buffer.from(fresh.secret_config));
          credential = await strategy.resolveCredential(freshSecret, fresh.config as DevServicePublicConfig);
        }
      }
    } else if (
      publicConfig.token_expires_at &&
      new Date(publicConfig.token_expires_at) < new Date()
    ) {
      // Token expired and can't refresh
      await supabase
        .from("chainthings_integrations")
        .update({
          status: "expired",
          last_error_at: new Date().toISOString(),
          last_error_message: "Token expired and refresh failed",
        })
        .eq("id", integration.id);
      throw new AuthExpiredError(service);
    }
  }

  const factory = await getAdapterFactory(service);
  return factory(credential.token, publicConfig);
}
