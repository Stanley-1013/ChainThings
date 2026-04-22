import { supabaseAdmin } from "@/lib/supabase/admin";
import type { NormalizedEvent, DevServicePublicConfig } from "./types";
import { generateReviewDraft, saveReviewDraft } from "./engines/code-review";
import { processMREvent } from "./orchestration/linker";
import { createDevServiceClient } from "./factory";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [60, 300, 900]; // 1min, 5min, 15min

export async function processEvent(eventId: string): Promise<void> {
  // Compare-and-set: received → processing
  const { data: event, error } = await supabaseAdmin
    .from("chainthings_webhook_events")
    .update({ status: "processing" })
    .eq("id", eventId)
    .eq("status", "received")
    .select("*")
    .single();

  if (error || !event) return; // Already picked up by another worker

  try {
    const normalized = event.normalized_event
      ? (event.payload as unknown as { _normalized?: NormalizedEvent })?._normalized ??
        rebuildNormalized(event)
      : null;

    if (!normalized) {
      await markCompleted(eventId);
      return;
    }

    await handleNormalizedEvent(
      event.tenant_id,
      event.service,
      event.integration_id,
      normalized,
      eventId,
    );

    await markCompleted(eventId);
  } catch (err) {
    const retryCount = (event.retry_count ?? 0) + 1;
    if (retryCount >= MAX_RETRIES) {
      await supabaseAdmin
        .from("chainthings_webhook_events")
        .update({
          status: "failed",
          error_message: err instanceof Error ? err.message : String(err),
          retry_count: retryCount,
          processed_at: new Date().toISOString(),
        })
        .eq("id", eventId);
    } else {
      const delay = RETRY_DELAYS[retryCount - 1] ?? 900;
      await supabaseAdmin
        .from("chainthings_webhook_events")
        .update({
          status: "received", // back to received for retry
          error_message: err instanceof Error ? err.message : String(err),
          retry_count: retryCount,
          next_retry_at: new Date(Date.now() + delay * 1000).toISOString(),
        })
        .eq("id", eventId);
    }
  }
}

async function handleNormalizedEvent(
  tenantId: string,
  service: string,
  integrationId: string,
  normalized: NormalizedEvent,
  webhookEventId: string,
): Promise<void> {
  const { eventName, resource } = normalized;

  if (eventName === "mr.opened" || eventName === "mr.updated") {
    // 1. Cross-service link + Jira transition
    await processMREvent(
      tenantId,
      service,
      integrationId,
      resource.ref,
      resource.url,
      resource.title ?? "",
      resource.body ?? "",
      resource.sourceBranch ?? "",
      "mr_opened",
    );

    // 2. Auto review (if enabled)
    const { data: integration } = await supabaseAdmin
      .from("chainthings_integrations")
      .select("config, dev_project_id")
      .eq("id", integrationId)
      .single();

    const config = integration?.config as DevServicePublicConfig | null;
    const devProjectId = integration?.dev_project_id as string | null | undefined;
    if (config?.auto_review_enabled) {
      const repos = config.auto_review_repos ?? [];
      if (repos.includes("*") || repos.includes(resource.repoRef)) {
        try {
          const client = devProjectId
            ? await createDevServiceClient(tenantId, devProjectId, service)
            : await createDevServiceClient(tenantId, "", service);
          const codeHost = client.asCodeHost?.();
          if (codeHost) {
            const diff = await codeHost.getMergeRequestDiff(resource.repoRef, resource.ref);
            const draft = await generateReviewDraft(diff, {
              type: "merge_request",
              ref: resource.ref,
              title: resource.title ?? "",
              url: resource.url,
            }, { language: config.review_language });

            await saveReviewDraft(
              tenantId,
              integrationId,
              service,
              resource.repoRef,
              { type: "merge_request", ref: resource.ref, title: resource.title ?? "", url: resource.url },
              draft,
              webhookEventId,
            );
          }
        } catch (err) {
          console.error(`Auto review failed for ${resource.repoRef}#${resource.ref}:`, err);
        }
      }
    }
  }

  if (eventName === "mr.merged") {
    await processMREvent(
      tenantId,
      service,
      integrationId,
      resource.ref,
      resource.url,
      resource.title ?? "",
      resource.body ?? "",
      resource.sourceBranch ?? "",
      "mr_merged",
    );
  }

  // issue events can be synced to items/memory in the future
}

function rebuildNormalized(event: Record<string, unknown>): NormalizedEvent | null {
  // Minimal rebuild from stored event data
  const { normalizeEvent } = require("./event-normalizer") as typeof import("./event-normalizer");
  return normalizeEvent(
    event.service as string,
    event.event_type as string,
    event.payload as unknown,
  );
}

async function markCompleted(eventId: string): Promise<void> {
  await supabaseAdmin
    .from("chainthings_webhook_events")
    .update({ status: "completed", processed_at: new Date().toISOString() })
    .eq("id", eventId);
}

/** Process all pending events (called by cron). */
export async function processAllPending(): Promise<number> {
  const { data: events } = await supabaseAdmin
    .from("chainthings_webhook_events")
    .select("id")
    .eq("status", "received")
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
    .order("created_at", { ascending: true })
    .limit(20);

  if (!events?.length) return 0;

  let processed = 0;
  for (const event of events) {
    await processEvent(event.id);
    processed++;
  }
  return processed;
}
