// n8n workflow template: Hedy.ai webhook → ChainThings API → Supabase
// Uses Set node (no code/crypto) to avoid n8n task runner restrictions

export function generateHedyWebhookWorkflow(
  tenantId: string,
  appBaseUrl: string,
  webhookSecret: string
) {
  const webhookPath = `hedy-${tenantId}`;

  return {
    name: `Hedy.ai Webhook (${tenantId.slice(0, 8)})`,
    nodes: [
      {
        parameters: {
          path: webhookPath,
          httpMethod: "POST",
          responseMode: "onReceived",
          responseCode: 200,
        },
        id: "webhook-trigger",
        name: "Hedy Webhook",
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [250, 300],
        webhookId: webhookPath,
      },
      {
        parameters: {
          method: "POST",
          url: `${appBaseUrl}/api/webhooks/hedy/${tenantId}`,
          sendHeaders: true,
          headerParameters: {
            parameters: [
              {
                name: "X-ChainThings-Secret",
                value: `={{ "${webhookSecret}" }}`,
              },
              { name: "Content-Type", value: "application/json" },
            ],
          },
          sendBody: true,
          specifyBody: "json",
          jsonBody: `={{\n  JSON.stringify({\n    type: "meeting_note",\n    title: $json.body.title || $json.body.meeting_title || "Untitled Meeting",\n    content: ($json.body.meeting_minutes || $json.body.recap || "") + "\\n\\n---\\n\\n" + ($json.body.transcript || $json.body.transcription || ""),\n    external_id: $json.body.sessionId || $json.body.session_id || $json.body.id || null,\n    metadata: {\n      source: "hedy.ai",\n      recap: $json.body.recap || null,\n      conversations: $json.body.conversations || null,\n      highlights: $json.body.highlights || [],\n      participants: $json.body.participants || [],\n      duration: $json.body.duration || null,\n      language: $json.body.language || null,\n      event: $json.body.event || null,\n      startTime: $json.body.startTime || null\n    }\n  })\n}}`,
        },
        id: "forward-to-chainthings",
        name: "Forward to ChainThings",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [470, 300],
      },
    ],
    connections: {
      "Hedy Webhook": {
        main: [
          [{ node: "Forward to ChainThings", type: "main", index: 0 }],
        ],
      },
    },
    webhookUrl: `/webhook/${webhookPath}`,
  };
}
