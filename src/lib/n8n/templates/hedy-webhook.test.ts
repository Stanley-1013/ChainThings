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

  it("generates 2 nodes: webhook and http request", () => {
    const wf = generateHedyWebhookWorkflow(tenantId, appBaseUrl, webhookSecret);
    expect(wf.nodes).toHaveLength(2);
    expect(wf.nodes[0].type).toBe("n8n-nodes-base.webhook");
    expect(wf.nodes[1].type).toBe("n8n-nodes-base.httpRequest");
  });

  it("sets webhook path using tenant ID", () => {
    const wf = generateHedyWebhookWorkflow(tenantId, appBaseUrl, webhookSecret);
    expect(wf.nodes[0].parameters.path).toBe(`hedy-${tenantId}`);
    expect(wf.webhookUrl).toBe(`/webhook/hedy-${tenantId}`);
  });

  it("embeds secret in http request header as expression", () => {
    const wf = generateHedyWebhookWorkflow(tenantId, appBaseUrl, webhookSecret);
    const headers = wf.nodes[1].parameters.headerParameters.parameters;
    const secretHeader = headers.find(
      (h: { name: string }) => h.name === "X-ChainThings-Secret"
    );
    expect(secretHeader.value).toContain(webhookSecret);
  });

  it("forwards to correct ChainThings API endpoint", () => {
    const wf = generateHedyWebhookWorkflow(tenantId, appBaseUrl, webhookSecret);
    expect(wf.nodes[1].parameters.url).toBe(
      `${appBaseUrl}/api/webhooks/hedy/${tenantId}`
    );
  });

  it("has correct node connections", () => {
    const wf = generateHedyWebhookWorkflow(tenantId, appBaseUrl, webhookSecret);
    expect(wf.connections["Hedy Webhook"].main[0][0].node).toBe(
      "Forward to ChainThings"
    );
  });

  it("maps Hedy body fields correctly in jsonBody expression", () => {
    const wf = generateHedyWebhookWorkflow(tenantId, appBaseUrl, webhookSecret);
    const jsonBody = wf.nodes[1].parameters.jsonBody;
    expect(jsonBody).toContain("$json.body.title");
    expect(jsonBody).toContain("$json.body.meeting_minutes");
    expect(jsonBody).toContain("$json.body.transcript");
    expect(jsonBody).toContain("$json.body.sessionId");
    expect(jsonBody).toContain("meeting_note");
  });
});
