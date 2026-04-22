import type { WebhookVerifier } from "./types";
import { GitHubWebhookVerifier } from "./adapters/github-webhook";
import { GitLabWebhookVerifier } from "./adapters/gitlab-webhook";
import { JiraWebhookVerifier } from "./adapters/jira-webhook";

const webhookRegistry: Record<string, WebhookVerifier> = {
  github: new GitHubWebhookVerifier(),
  gitlab: new GitLabWebhookVerifier(),
  jira: new JiraWebhookVerifier(),
};

export function getWebhookVerifier(
  service: string,
): WebhookVerifier | undefined {
  return webhookRegistry[service];
}
