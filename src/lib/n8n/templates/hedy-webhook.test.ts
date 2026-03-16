import { describe, it, expect, vi } from "vitest";

vi.unmock("@/lib/n8n/templates/hedy-webhook");

import { generateHedyWebhookWorkflow } from "./hedy-webhook";

describe("generateHedyWebhookWorkflow", () => {
  const tenantId = "abc12345-1111-2222-3333-444444444444";
  const appBaseUrl = "https://app.example.com";
  const webhookSecret = "super-secret";

  it("generates a workflow with correct name", () => {
    const wf = generateHedyWebhookWorkflow(tenantId, appBaseUrl, webhookSecret);
    expect(wf.name).toBe(`Hedy.ai Webhook (${tenantId.slice(0, 8)})`);
  });

  it("generates 3 nodes: webhook, transform, http request", () => {
    const wf = generateHedyWebhookWorkflow(tenantId, appBaseUrl, webhookSecret);
    expect(wf.nodes).toHaveLength(3);
    expect(wf.nodes[0].type).toBe("n8n-nodes-base.webhook");
    expect(wf.nodes[1].type).toBe("n8n-nodes-base.code");
    expect(wf.nodes[2].type).toBe("n8n-nodes-base.httpRequest");
  });

  it("sets webhook path using tenant ID", () => {
    const wf = generateHedyWebhookWorkflow(tenantId, appBaseUrl, webhookSecret);
    expect(wf.nodes[0].parameters.path).toBe(`hedy-${tenantId}`);
    expect(wf.webhookUrl).toBe(`/webhook/hedy-${tenantId}`);
  });

  it("embeds tenant ID and secret in transform code", () => {
    const wf = generateHedyWebhookWorkflow(tenantId, appBaseUrl, webhookSecret);
    const code = wf.nodes[1].parameters.jsCode;
    expect(code).toContain(tenantId);
    expect(code).toContain(webhookSecret);
    expect(code).toContain("meeting_note");
    expect(code).toContain("createHmac");
  });

  it("forwards to correct ChainThings API endpoint", () => {
    const wf = generateHedyWebhookWorkflow(tenantId, appBaseUrl, webhookSecret);
    expect(wf.nodes[2].parameters.url).toBe(
      `${appBaseUrl}/api/webhooks/hedy/${tenantId}`
    );
  });

  it("has correct node connections", () => {
    const wf = generateHedyWebhookWorkflow(tenantId, appBaseUrl, webhookSecret);
    expect(wf.connections["Hedy Webhook"].main[0][0].node).toBe(
      "Transform Data"
    );
    expect(wf.connections["Transform Data"].main[0][0].node).toBe(
      "Forward to ChainThings"
    );
  });
});
