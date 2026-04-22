import type { CredentialStrategy } from "./types";
import { GitHubOAuthStrategy } from "./adapters/github-auth";
import { GitLabPatStrategy } from "./adapters/gitlab-auth";
import { JiraApiTokenStrategy } from "./adapters/jira-auth";

const credentialRegistry: Record<string, CredentialStrategy> = {
  github: new GitHubOAuthStrategy(),
  gitlab: new GitLabPatStrategy(),
  jira: new JiraApiTokenStrategy(),
};

export function getCredentialStrategy(
  service: string,
): CredentialStrategy | undefined {
  return credentialRegistry[service];
}

export function requiresOAuth(service: string): boolean {
  return credentialRegistry[service]?.requiresOAuth() ?? false;
}

export function getSupportedServices(): string[] {
  return Object.keys(credentialRegistry);
}
