export function mockChatResponse(content: string) {
  return {
    id: "chatcmpl-test",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  };
}

export function mockN8nWorkflowResponse(name: string) {
  const workflowJson = JSON.stringify({
    name,
    description: "Test workflow",
    nodes: [{ type: "n8n-nodes-base.manualTrigger" }],
    connections: {},
  });

  return mockChatResponse(
    `Here's your workflow:\n\n\`\`\`n8n-workflow\n${workflowJson}\n\`\`\`\n\nThis workflow does things.`
  );
}

export function mockJsonWorkflowResponse(name: string) {
  return mockChatResponse(
    JSON.stringify({
      name,
      description: "Generated workflow",
      nodes: [{ type: "n8n-nodes-base.start" }],
      connections: {},
    })
  );
}
