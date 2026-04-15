// n8n workflow template: Hedy.ai webhook → ChainThings API
// Hedy webhook payload: { event: "session.ended", data: { sessionId, title, ... }, timestamp }
// Hedy sends X-Hedy-Event header with event type

export function generateHedyWebhookWorkflow(
  tenantId: string,
  appBaseUrl: string,
  webhookSecret: string
) {
  const webhookPath = `hedy-${tenantId}`;

  // n8n expression: Hedy wraps payload in { event, data, timestamp }
  // $json.body.data.* for session fields, $json.body.event for event type
  // For todo.exported: data is { id, sessionId, text, dueDate }
  const jsonBody = `={{
  JSON.stringify({
    type: "meeting_note",
    title: $json.body.data.title || "Untitled Meeting",
    content: ($json.body.data.meeting_minutes || $json.body.data.recap || "")
      + ($json.body.data.transcript ? "\\n\\n---\\n\\n" + $json.body.data.transcript : ""),
    external_id: $json.body.data.sessionId || null,
    event: $json.headers["x-hedy-event"] || $json.body.event || null,
    text: $json.body.data.text || null,
    dueDate: $json.body.data.dueDate || null,
    todos: $json.body.data.user_todos || [],
    metadata: {
      source: "hedy.ai",
      event: $json.headers["x-hedy-event"] || $json.body.event || null,
      session_type: $json.body.data.session_type || null,
      recap: $json.body.data.recap || null,
      conversations: $json.body.data.conversations || null,
      structured_conversations: $json.body.data.structured_conversations || null,
      highlights: ($json.body.data.highlights || []).map(function(h) {
        return { title: h.title, aiInsight: h.aiInsight, quote: h.rawQuote || h.cleanedQuote }
      }),
      user_todos: $json.body.data.user_todos || [],
      duration: $json.body.data.duration || null,
      startTime: $json.body.data.startTime || null,
      endTime: $json.body.data.endTime || null,
      topic: $json.body.data.topic || null
    }
  })
}}`;

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
          jsonBody,
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
