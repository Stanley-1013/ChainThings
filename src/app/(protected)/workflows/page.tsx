"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState, useCallback } from "react";

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  n8n_workflow_id: string | null;
  created_at: string;
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const loadWorkflows = useCallback(async () => {
    const { data } = await supabase
      .from("chainthings_workflows")
      .select("id, name, description, status, n8n_workflow_id, created_at")
      .order("created_at", { ascending: false });

    if (data) setWorkflows(data);
  }, []);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || generating) return;

    setGenerating(true);
    setError(null);

    try {
      const res = await fetch("/api/workflows/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Generation failed");
      }

      setPrompt("");
      await loadWorkflows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  const statusColor: Record<string, string> = {
    active: "text-green-600",
    pending: "text-yellow-600",
    generating: "text-blue-600",
    error: "text-red-600",
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Workflows</h1>

      <form onSubmit={handleGenerate} className="space-y-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the workflow you want to create... e.g., 'A webhook that receives a JSON payload and sends an email notification'"
          rows={3}
          disabled={generating}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={generating || !prompt.trim()}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {generating ? "Generating..." : "Generate workflow"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {workflows.length > 0 ? (
        <div className="space-y-2">
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className="rounded border border-gray-200 p-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{wf.name}</h3>
                <span className={`text-xs font-medium ${statusColor[wf.status] || "text-gray-500"}`}>
                  {wf.status}
                </span>
              </div>
              {wf.description && (
                <p className="text-sm text-gray-500 mt-1">{wf.description}</p>
              )}
              <div className="flex items-center gap-4 mt-2">
                <span className="text-xs text-gray-400">
                  {new Date(wf.created_at).toLocaleDateString()}
                </span>
                {wf.n8n_workflow_id && (
                  <a
                    href={`http://localhost:5678/workflow/${wf.n8n_workflow_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Open in n8n
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-500">
          No workflows yet. Describe one above and let AI generate it!
        </p>
      )}
    </div>
  );
}
