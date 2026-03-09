const N8N_URL = process.env.N8N_API_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY || "";

interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  tags?: { name: string }[];
  nodes?: unknown[];
  connections?: Record<string, unknown>;
}

export async function createWorkflow(
  name: string,
  nodes: unknown[],
  connections: Record<string, unknown>
): Promise<N8nWorkflow> {
  const res = await fetch(`${N8N_URL}/api/v1/workflows`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": N8N_API_KEY,
    },
    body: JSON.stringify({
      name: `[ChainThings] ${name}`,
      nodes,
      connections,
      settings: {},
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`n8n error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function activateWorkflow(id: string): Promise<N8nWorkflow> {
  const res = await fetch(`${N8N_URL}/api/v1/workflows/${id}/activate`, {
    method: "POST",
    headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`n8n activate error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function listWorkflows(): Promise<{ data: N8nWorkflow[] }> {
  const res = await fetch(`${N8N_URL}/api/v1/workflows`, {
    headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`n8n error ${res.status}: ${text}`);
  }

  return res.json();
}
