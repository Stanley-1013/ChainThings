"use client";

import { useState, useEffect, useCallback } from "react";

interface Integration {
  id: string;
  service: string;
  label: string;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

export default function SettingsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);

  // Hedy form state
  const [hedyApiKey, setHedyApiKey] = useState("");
  const [hedySaving, setHedySaving] = useState(false);
  const [hedySetupLoading, setHedySetupLoading] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadIntegrations = useCallback(async () => {
    const res = await fetch("/api/integrations");
    const json = await res.json();
    setIntegrations(json.data || []);
    setLoading(false);

    // Load existing hedy config
    const hedy = (json.data || []).find(
      (i: Integration) => i.service === "hedy.ai"
    );
    if (hedy) {
      setHedyApiKey((hedy.config?.api_key as string) || "");
      if (hedy.config?.n8n_workflow_id) {
        const n8nUrl =
          window.location.protocol +
          "//" +
          window.location.hostname +
          ":5678";
        setWebhookUrl(
          `${n8nUrl}/webhook/hedy-${hedy.config?.tenant_id || "..."}`
        );
      }
    }
  }, []);

  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations]);

  async function saveHedyKey() {
    setHedySaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: "hedy.ai",
          label: "Hedy.ai",
          config: { api_key: hedyApiKey },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMessage({ type: "success", text: "API key saved!" });
      loadIntegrations();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save",
      });
    } finally {
      setHedySaving(false);
    }
  }

  async function enableHedyWorkflow() {
    setHedySetupLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/integrations/hedy/setup", {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setWebhookUrl(json.data.webhookUrl);
      setMessage({
        type: "success",
        text: json.data.alreadyExists
          ? "Workflow already exists!"
          : "Webhook workflow created and activated!",
      });
      loadIntegrations();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Setup failed",
      });
    } finally {
      setHedySetupLoading(false);
    }
  }

  async function deleteIntegration(id: string) {
    if (!confirm("Are you sure you want to delete this integration?")) return;
    try {
      await fetch("/api/integrations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setWebhookUrl("");
      setHedyApiKey("");
      loadIntegrations();
    } catch {
      // ignore
    }
  }

  const hedyIntegration = integrations.find((i) => i.service === "hedy.ai");
  const hasWorkflow = !!(hedyIntegration?.config as Record<string, unknown>)
    ?.n8n_workflow_id;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {message && (
        <div
          className={`mb-4 p-3 rounded text-sm ${
            message.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Hedy.ai Integration */}
      <section className="border rounded-lg p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Hedy.ai</h2>
            <p className="text-sm text-gray-500">
              Voice-to-notes meeting integration
            </p>
          </div>
          {hedyIntegration && (
            <button
              onClick={() => deleteIntegration(hedyIntegration.id)}
              className="text-xs text-red-500 hover:underline"
            >
              Remove
            </button>
          )}
        </div>

        <div className="space-y-4">
          {/* Step 1: API Key */}
          <div>
            <label className="block text-sm font-medium mb-1">
              1. Hedy API Key
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={hedyApiKey}
                onChange={(e) => setHedyApiKey(e.target.value)}
                placeholder="Enter your Hedy API key"
                className="flex-1 border rounded px-3 py-2 text-sm"
              />
              <button
                onClick={saveHedyKey}
                disabled={hedySaving || !hedyApiKey}
                className="px-4 py-2 bg-black text-white text-sm rounded disabled:opacity-50"
              >
                {hedySaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>

          {/* Step 2: Enable Webhook */}
          {hedyIntegration && (
            <div>
              <label className="block text-sm font-medium mb-1">
                2. Enable Webhook Workflow
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Creates an n8n workflow that receives Hedy webhooks and saves
                meeting notes to your items.
              </p>
              <button
                onClick={enableHedyWorkflow}
                disabled={hedySetupLoading || hasWorkflow}
                className={`px-4 py-2 text-sm rounded ${
                  hasWorkflow
                    ? "bg-green-100 text-green-800 cursor-default"
                    : "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                }`}
              >
                {hedySetupLoading
                  ? "Setting up..."
                  : hasWorkflow
                    ? "Workflow Active"
                    : "Enable Hedy Integration"}
              </button>
            </div>
          )}

          {/* Webhook URL */}
          {webhookUrl && (
            <div>
              <label className="block text-sm font-medium mb-1">
                Webhook URL
              </label>
              <div className="flex gap-2">
                <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-xs break-all">
                  {webhookUrl}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(webhookUrl)}
                  className="px-3 py-2 text-xs border rounded hover:bg-gray-50"
                >
                  Copy
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Paste this URL in your Hedy.ai webhook settings.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Other Integrations */}
      {loading ? (
        <p className="text-sm text-gray-500">Loading integrations...</p>
      ) : (
        integrations.filter((i) => i.service !== "hedy.ai").length > 0 && (
          <section className="border rounded-lg p-5">
            <h2 className="text-lg font-semibold mb-3">Other Integrations</h2>
            <div className="space-y-2">
              {integrations
                .filter((i) => i.service !== "hedy.ai")
                .map((integration) => (
                  <div
                    key={integration.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded"
                  >
                    <div>
                      <span className="text-sm font-medium">
                        {integration.label}
                      </span>
                      <span className="text-xs text-gray-400 ml-2">
                        {integration.service}
                      </span>
                    </div>
                    <button
                      onClick={() => deleteIntegration(integration.id)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                ))}
            </div>
          </section>
        )
      )}
    </div>
  );
}
