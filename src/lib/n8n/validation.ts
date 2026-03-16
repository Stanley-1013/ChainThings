const ALLOWED_NODE_TYPES = new Set([
  "n8n-nodes-base.webhook",
  "n8n-nodes-base.set",
  "n8n-nodes-base.if",
  "n8n-nodes-base.switch",
  "n8n-nodes-base.merge",
  "n8n-nodes-base.noOp",
  "n8n-nodes-base.manualTrigger",
  "n8n-nodes-base.scheduleTrigger",
  "n8n-nodes-base.respondToWebhook",
  "n8n-nodes-base.dateTime",
  "n8n-nodes-base.splitInBatches",
  "n8n-nodes-base.wait",
  "n8n-nodes-base.filter",
  "n8n-nodes-base.sort",
  "n8n-nodes-base.limit",
  "n8n-nodes-base.removeDuplicates",
  "n8n-nodes-base.itemLists",
  "n8n-nodes-base.start",
]);

export function validateWorkflowNodes(
  nodes: unknown[]
): { valid: boolean; disallowed: string[] } {
  const disallowed: string[] = [];

  for (const node of nodes) {
    const type =
      typeof node === "object" && node !== null && "type" in node
        ? (node as { type: string }).type
        : undefined;

    if (type && !ALLOWED_NODE_TYPES.has(type)) {
      disallowed.push(type);
    }
  }

  return { valid: disallowed.length === 0, disallowed };
}
