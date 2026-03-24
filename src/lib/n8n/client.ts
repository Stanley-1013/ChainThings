const N8N_URL = process.env.N8N_API_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY || "";
const N8N_TIMEOUT_MS = Number(process.env.N8N_TIMEOUT_MS) || 10_000;

export interface N8nTag {
  id: string;
  name: string;
}

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  tags?: N8nTag[];
  nodes?: unknown[];
  connections?: Record<string, unknown>;
}

async function n8nFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);
  try {
    const res = await fetch(`${N8N_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "X-N8N-API-KEY": N8N_API_KEY,
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`n8n error ${res.status}: ${text}`);
    }
    return res;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`n8n request timed out after ${N8N_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveTagsBatched(tagNames: string[]): Promise<N8nTag[]> {
  // Single list call instead of N calls
  const listRes = await n8nFetch("/api/v1/tags");
  const allTags: N8nTag[] = await listRes.json();
  const tagMap = new Map(allTags.map((t) => [t.name, t]));

  const resolved: N8nTag[] = [];
  const toCreate = tagNames.filter((name) => !tagMap.has(name));

  // Add existing tags
  for (const name of tagNames) {
    const existing = tagMap.get(name);
    if (existing) resolved.push(existing);
  }

  // Create missing tags in parallel
  if (toCreate.length > 0) {
    const created = await Promise.all(
      toCreate.map(async (name) => {
        const res = await n8nFetch("/api/v1/tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        return res.json() as Promise<N8nTag>;
      })
    );
    resolved.push(...created);
  }

  return resolved;
}

async function applyTags(workflowId: string, tagNames: string[]) {
  const tagObjects = await resolveTagsBatched(tagNames);
  await n8nFetch(`/api/v1/workflows/${workflowId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags: tagObjects }),
  });
}

export async function createWorkflow(
  name: string,
  nodes: unknown[],
  connections: Record<string, unknown>,
  tags?: string[]
): Promise<N8nWorkflow> {
  const res = await n8nFetch("/api/v1/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `[ChainThings] ${name}`,
      nodes,
      connections,
      settings: {},
    }),
  });
  const workflow: N8nWorkflow = await res.json();

  // Apply tags via separate API calls (n8n doesn't accept tags on create)
  if (tags && tags.length > 0) {
    try {
      await applyTags(workflow.id, tags);
    } catch {
      // Non-fatal: workflow was created, tagging failed
      console.warn(`Failed to apply tags to workflow ${workflow.id}`);
    }
  }

  return workflow;
}

export async function getWorkflow(id: string): Promise<N8nWorkflow> {
  const res = await n8nFetch(`/api/v1/workflows/${id}`);
  return res.json();
}

export async function activateWorkflow(id: string): Promise<N8nWorkflow> {
  const res = await n8nFetch(`/api/v1/workflows/${id}/activate`, {
    method: "POST",
  });
  return res.json();
}

export async function deleteWorkflow(id: string): Promise<void> {
  await n8nFetch(`/api/v1/workflows/${id}`, { method: "DELETE" });
}

export async function listWorkflows(): Promise<{ data: N8nWorkflow[] }> {
  const res = await n8nFetch("/api/v1/workflows");
  return res.json();
}

const N8N_EDITOR_BASE_URL = process.env.N8N_EDITOR_BASE_URL || "";

export function getWorkflowEditorUrl(workflowId: string): string | null {
  if (!N8N_EDITOR_BASE_URL) return null;
  if (!/^https?:\/\//.test(N8N_EDITOR_BASE_URL)) return null;
  return `${N8N_EDITOR_BASE_URL.replace(/\/+$/, "")}/workflow/${workflowId}`;
}
