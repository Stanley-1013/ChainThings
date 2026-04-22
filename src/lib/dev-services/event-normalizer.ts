import type { EventNormalizerFn, NormalizedEvent } from "./types";
import { normalizeGitHubEvent } from "./adapters/github-normalizer";
import { normalizeGitLabEvent } from "./adapters/gitlab-normalizer";
import { normalizeJiraEvent } from "./adapters/jira-normalizer";

const eventNormalizers: Record<string, EventNormalizerFn> = {
  github: normalizeGitHubEvent,
  gitlab: normalizeGitLabEvent,
  jira: normalizeJiraEvent,
};

export function normalizeEvent(
  service: string,
  rawEventType: string,
  payload: unknown,
): NormalizedEvent | null {
  const normalizer = eventNormalizers[service];
  if (!normalizer) return null;
  return normalizer(rawEventType, payload);
}
