// n8n workflow template: Hedy.ai webhook → Supabase chainthings_items

export function generateHedyWebhookWorkflow(
  tenantId: string,
  supabaseUrl: string,
  serviceRoleKey: string
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
          jsCode: `// Transform Hedy.ai webhook payload → chainthings_items format
const input = $input.first().json;

// Hedy sends meeting data with these fields:
// title, summary, transcript, todos, highlights, session_id, etc.
const item = {
  tenant_id: "${tenantId}",
  type: "meeting_note",
  title: input.title || input.meeting_title || "Untitled Meeting",
  content: [
    input.summary || "",
    "",
    "---",
    "",
    input.transcript || input.transcription || "",
  ].filter(Boolean).join("\\n"),
  external_id: input.session_id || input.id || input.meeting_id || null,
  metadata: {
    source: "hedy.ai",
    todos: input.todos || input.action_items || [],
    highlights: input.highlights || input.key_points || [],
    participants: input.participants || [],
    duration: input.duration || null,
    language: input.language || null,
    raw_webhook: input,
  },
};

return [{ json: item }];`,
        },
        id: "transform-data",
        name: "Transform Data",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [470, 300],
      },
      {
        parameters: {
          method: "POST",
          url: `${supabaseUrl}/rest/v1/chainthings_items`,
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: "apikey", value: serviceRoleKey },
              { name: "Authorization", value: `Bearer ${serviceRoleKey}` },
              { name: "Content-Type", value: "application/json" },
              { name: "Prefer", value: "return=representation" },
            ],
          },
          sendBody: true,
          specifyBody: "json",
          jsonBody: "={{ JSON.stringify($json) }}",
        },
        id: "save-to-supabase",
        name: "Save to Supabase",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [690, 300],
      },
    ],
    connections: {
      "Hedy Webhook": {
        main: [[{ node: "Transform Data", type: "main", index: 0 }]],
      },
      "Transform Data": {
        main: [[{ node: "Save to Supabase", type: "main", index: 0 }]],
      },
    },
    webhookUrl: `/webhook/${webhookPath}`,
  };
}
