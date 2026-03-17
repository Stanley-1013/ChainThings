"use client";

import { useState, useEffect, useCallback } from "react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Settings2,
  Trash2,
  Key,
  Webhook,
  Copy,
  Check,
  Info,
  Loader2,
  ExternalLink,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface Integration {
  id: string;
  service: string;
  label: string;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

export function IntegrationsSection() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [hedyApiKey, setHedyApiKey] = useState("");
  const [hedySaving, setHedySaving] = useState(false);
  const [hedySetupLoading, setHedySetupLoading] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [integrationToDelete, setIntegrationToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadIntegrations = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations");
      const json = await res.json();
      setIntegrations(json.data || []);
      const hedy = (json.data || []).find(
        (i: Integration) => i.service === "hedy.ai"
      );
      if (hedy) {
        // API returns redacted key ("••••••••") — don't pre-fill the input with it
        const rawKey = (hedy.config?.api_key as string) || "";
        setHedyApiKey(rawKey.includes("•") ? "" : rawKey);
        if (hedy.config?.n8n_workflow_id) {
          try {
            const setupRes = await fetch("/api/integrations/hedy/setup", { method: "POST" });
            const setupJson = await setupRes.json();
            if (setupJson.data?.webhookUrl) {
              setWebhookUrl(setupJson.data.webhookUrl);
            }
          } catch {
            setWebhookUrl("");
          }
        }
      }
    } catch (err) {
      console.error("Failed to load integrations", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations]);

  async function saveHedyKey() {
    setHedySaving(true);
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
      toast.success("Hedy API key saved successfully");
      loadIntegrations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save API key");
    } finally {
      setHedySaving(false);
    }
  }

  async function enableHedyWorkflow() {
    setHedySetupLoading(true);
    try {
      const res = await fetch("/api/integrations/hedy/setup", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setWebhookUrl(json.data.webhookUrl);
      toast.success(
        json.data.alreadyExists
          ? "Workflow already exists!"
          : "Hedy webhook workflow created and activated!"
      );
      loadIntegrations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setHedySetupLoading(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!integrationToDelete) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/integrations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: integrationToDelete }),
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Integration removed");
      setWebhookUrl("");
      setHedyApiKey("");
      loadIntegrations();
    } catch {
      toast.error("Failed to delete integration");
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setIntegrationToDelete(null);
    }
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    toast.success("Webhook URL copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const hedyIntegration = integrations.find((i) => i.service === "hedy.ai");
  const hasWorkflow = !!(hedyIntegration?.config as Record<string, unknown>)?.n8n_workflow_id;

  return (
    <div className="space-y-6">
      {/* Hedy.ai Integration */}
      <Card className="overflow-hidden border-primary/10">
        <CardHeader className="bg-muted/30 pb-6 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <Settings2 className="h-6 w-6" />
              </div>
              <div>
                <CardTitle className="text-xl">Hedy.ai Integration</CardTitle>
                <CardDescription>Voice-to-notes meeting automation</CardDescription>
              </div>
            </div>
            {hedyIntegration && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => {
                  setIntegrationToDelete(hedyIntegration.id);
                  setDeleteDialogOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-6 space-y-8">
          {/* Step 1: API Key */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Badge variant="outline" className="h-5 w-5 rounded-full p-0 flex items-center justify-center border-primary text-primary">1</Badge>
              <Label htmlFor="hedy-api-key">Configure Hedy API Key</Label>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Key className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="hedy-api-key"
                  type="password"
                  value={hedyApiKey}
                  onChange={(e) => setHedyApiKey(e.target.value)}
                  placeholder="Paste your Hedy API key here"
                  className="pl-10"
                />
              </div>
              <Button onClick={saveHedyKey} disabled={hedySaving || !hedyApiKey}>
                {hedySaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                {hedySaving ? "Saving..." : "Save Key"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" />
              Your key is encrypted and stored securely.
            </p>
          </div>

          <Separator />

          {/* Step 2: Enable Webhook */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Badge variant="outline" className={cn("h-5 w-5 rounded-full p-0 flex items-center justify-center border-primary text-primary", !hedyIntegration && "opacity-50")}>2</Badge>
              <Label className={!hedyIntegration ? "text-muted-foreground" : ""}>Activate Webhook Automation</Label>
            </div>
            <div className="bg-muted/20 border rounded-lg p-4 space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                This will create and activate an n8n workflow that automatically receives meeting notes from Hedy.ai and saves them to your ChainThings workspace.
              </p>
              <Button
                onClick={enableHedyWorkflow}
                disabled={!hedyIntegration || hedySetupLoading || hasWorkflow}
                variant={hasWorkflow ? "secondary" : "default"}
                className={cn(hasWorkflow && "bg-green-100 text-green-800 hover:bg-green-100 border-green-200 dark:bg-green-900 dark:text-green-200 dark:border-green-700")}
              >
                {hedySetupLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : hasWorkflow ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Zap className="mr-2 h-4 w-4" />
                )}
                {hedySetupLoading ? "Setting up..." : hasWorkflow ? "Workflow Active" : "Enable Hedy Integration"}
              </Button>
            </div>
          </div>

          {/* Webhook URL Result */}
          {webhookUrl && (
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Webhook Endpoint</Label>
              <div className="flex gap-2">
                <code className="flex-1 bg-muted px-4 py-2.5 rounded-lg text-[13px] font-mono border break-all">
                  {webhookUrl}
                </code>
                <Button variant="outline" size="icon" onClick={copyToClipboard} className="shrink-0">
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex items-center gap-2 text-xs bg-blue-50 dark:bg-blue-950 text-blue-800 dark:text-blue-200 p-3 rounded-md border border-blue-100 dark:border-blue-800">
                <ExternalLink className="h-4 w-4 shrink-0" />
                <p>Paste this URL into your <strong>Hedy.ai account settings</strong> under &ldquo;Webhook URL&rdquo; to start receiving notes.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Other Integrations */}
      {!loading && integrations.filter((i) => i.service !== "hedy.ai").length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Other Integrations</CardTitle>
            <CardDescription>Currently active third-party connections</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {integrations
                .filter((i) => i.service !== "hedy.ai")
                .map((integration) => (
                  <div
                    key={integration.id}
                    className="flex items-center justify-between p-4 border rounded-xl hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-muted rounded-lg">
                        <Webhook className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold">{integration.label}</div>
                        <div className="text-xs text-muted-foreground uppercase">{integration.service}</div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        setIntegrationToDelete(integration.id);
                        setDeleteDialogOpen(true);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary opacity-20" />
          <p className="text-sm text-muted-foreground">Loading integrations...</p>
        </div>
      )}

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Remove Integration"
        description="Are you sure you want to remove this integration? This will stop the workflow but won't delete your existing data."
        confirmLabel="Remove"
        variant="destructive"
        loading={deleting}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
