import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getWebhookVerifier } from "@/lib/dev-services/webhook-registry";
import { normalizeEvent } from "@/lib/dev-services/event-normalizer";
import { createJsonRequest, getJsonResponse } from "@/__tests__/helpers";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/dev-services/webhook-registry", () => ({
  getWebhookVerifier: vi.fn(),
}));

vi.mock("@/lib/dev-services/event-normalizer", () => ({
  normalizeEvent: vi.fn(),
}));

const mockAdminFrom = vi.mocked(supabaseAdmin.from);
const mockGetWebhookVerifier = vi.mocked(getWebhookVerifier);
const mockNormalizeEvent = vi.mocked(normalizeEvent);

interface IntegrationRow {
  id: string;
  tenant_id: string;
  webhook_secret: string | null;
  dev_project_id: string | null;
}

function routeParams(service = "github", integrationId = "integration-1") {
  return { params: Promise.resolve({ service, integrationId }) };
}

function setupVerifier(options: {
  verified?: boolean;
  deliveryId?: string | null;
  eventType?: string;
} = {}) {
  const verifier = {
    verify: vi.fn(() => options.verified ?? true),
    getDeliveryId: vi.fn(() => options.deliveryId === undefined ? "delivery-1" : options.deliveryId),
    getEventType: vi.fn(() => options.eventType ?? "push"),
  };
  mockGetWebhookVerifier.mockReturnValue(verifier as never);
  return verifier;
}

function setupAdmin(options: {
  integration?: IntegrationRow | null;
  existingEvent?: { id: string } | null;
  insertError?: { code?: string; message: string } | null;
  insertedEvent?: { id: string };
} = {}) {
  const eventInserts: unknown[] = [];
  const integration = options.integration === undefined
    ? {
      id: "integration-1",
      tenant_id: "tenant-456",
      webhook_secret: "webhook-secret",
      dev_project_id: "project-1",
    }
    : options.integration;

  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "chainthings_integrations") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => ({ data: integration, error: null })),
              })),
            })),
          })),
        })),
      } as never;
    }

    if (table === "chainthings_webhook_events") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => ({ data: options.existingEvent ?? null, error: null })),
            })),
          })),
        })),
        insert: vi.fn((payload: unknown) => {
          eventInserts.push(payload);
          return {
            select: vi.fn(() => ({
              single: vi.fn(() => ({
                data: options.insertError ? null : options.insertedEvent ?? { id: "event-1" },
                error: options.insertError ?? null,
              })),
            })),
          };
        }),
      } as never;
    }

    return {} as never;
  });

  return { eventInserts };
}

function webhookRequest(
  body: Record<string, unknown> | string = { ref: "refs/heads/main" },
  headers: Record<string, string> = { "x-github-delivery": "delivery-1" },
) {
  if (typeof body === "string") {
    return new Request("http://localhost/api/dev-services/webhooks/github/integration-1", {
      method: "POST",
      headers,
      body,
    });
  }
  return createJsonRequest("http://localhost/api/dev-services/webhooks/github/integration-1", body);
}

describe("POST /api/dev-services/webhooks/[service]/[integrationId]", () => {
  const originalFetch = global.fetch;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
    process.env.CRON_SECRET = "cron-secret";
    global.fetch = vi.fn(async () => new Response(null, { status: 202 })) as never;
    setupVerifier();
    setupAdmin();
    mockNormalizeEvent.mockReturnValue({ eventName: "repo_push" } as never);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    process.env.CRON_SECRET = originalCronSecret;
    vi.restoreAllMocks();
  });

  it("should return 404 when the integration does not exist", async () => {
    setupAdmin({ integration: null });

    const response = await POST(webhookRequest(), routeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Integration not found");
  });

  it("should return 400 for unsupported webhook services", async () => {
    mockGetWebhookVerifier.mockReturnValue(undefined);

    const response = await POST(webhookRequest(), routeParams("bitbucket"));
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Unsupported service: bitbucket");
  });

  it("should return 401 when the webhook signature is invalid", async () => {
    setupVerifier({ verified: false });

    const response = await POST(webhookRequest(), routeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Signature verification failed");
  });

  it("should return 400 for malformed JSON payloads after signature verification", async () => {
    const response = await POST(webhookRequest("{not-json"), routeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid JSON payload");
  });

  it("should return 200 when the delivery was already stored", async () => {
    setupAdmin({ existingEvent: { id: "event-existing" } });

    const response = await POST(webhookRequest(), routeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, duplicate: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should return 200 when insert hits a unique constraint race", async () => {
    const { eventInserts } = setupAdmin({
      insertError: { code: "23505", message: "duplicate key" },
    });

    const response = await POST(webhookRequest(), routeParams());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, duplicate: true });
    expect(eventInserts).toHaveLength(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should enqueue a GitHub webhook event and trigger the worker", async () => {
    const { eventInserts } = setupAdmin();
    setupVerifier({ deliveryId: "gh-delivery", eventType: "push" });

    const response = await POST(webhookRequest({ ref: "refs/heads/main" }), routeParams("github"));
    const body = await getJsonResponse(response);

    expect(response.status).toBe(202);
    expect(body).toEqual({ success: true, eventId: "event-1" });
    expect(mockNormalizeEvent).toHaveBeenCalledWith("github", "push", { ref: "refs/heads/main" });
    expect(eventInserts[0]).toMatchObject({
      tenant_id: "tenant-456",
      integration_id: "integration-1",
      service: "github",
      event_type: "push",
      normalized_event: "repo_push",
      delivery_id: "gh-delivery",
      status: "received",
      dev_project_id: "project-1",
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/dev-services/worker",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer cron-secret",
        },
        body: JSON.stringify({ eventId: "event-1" }),
      }),
    );
  });

  it("should enqueue a GitLab webhook event", async () => {
    const { eventInserts } = setupAdmin({
      integration: {
        id: "integration-1",
        tenant_id: "tenant-456",
        webhook_secret: "webhook-secret",
        dev_project_id: null,
      },
    });
    setupVerifier({ deliveryId: "gitlab-delivery", eventType: "Merge Request Hook" });
    mockNormalizeEvent.mockReturnValue({ eventName: "merge_request" } as never);

    const response = await POST(
      webhookRequest({ object_kind: "merge_request" }, { "x-gitlab-event": "Merge Request Hook" }),
      routeParams("gitlab"),
    );
    const body = await getJsonResponse(response);

    expect(response.status).toBe(202);
    expect(body).toEqual({ success: true, eventId: "event-1" });
    expect(mockNormalizeEvent).toHaveBeenCalledWith(
      "gitlab",
      "Merge Request Hook",
      { object_kind: "merge_request" },
    );
    expect(eventInserts[0]).toMatchObject({
      service: "gitlab",
      event_type: "Merge Request Hook",
      normalized_event: "merge_request",
      delivery_id: "gitlab-delivery",
      dev_project_id: null,
    });
  });
});
