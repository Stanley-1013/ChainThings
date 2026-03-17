"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

interface Integration {
  id: string;
  service: string;
  label: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

const MAX_SYSTEM_PROMPT = 2000;

export function AiSection() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [dirty, setDirty] = useState(false);
  const [activeIntegration, setActiveIntegration] = useState<Integration | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/integrations", { signal: controller.signal })
      .then((r) => r.json())
      .then((json) => {
        const data = json.data || [];
        setIntegrations(data);
        const zc = data.find((i: Integration) => i.service === "zeroclaw");
        const oc = data.find((i: Integration) => i.service === "openclaw");
        const active = zc || oc || null;
        setActiveIntegration(active);
        if (active) {
          setSystemPrompt((active.config?.system_prompt as string) || "");
        }
      })
      .catch((err) => { if (err.name !== "AbortError") toast.error("Failed to load AI settings"); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const handleSave = async () => {
    if (!activeIntegration) return;
    setSaving(true);
    try {
      const res = await fetch("/api/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeIntegration.id,
          config: { system_prompt: systemPrompt },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setDirty(false);
      toast.success("AI settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const providerName = activeIntegration
    ? activeIntegration.service === "zeroclaw"
      ? "ZeroClaw"
      : "OpenClaw"
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          AI Assistant
        </CardTitle>
        <CardDescription>Configure your AI provider and behavior</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Provider status */}
        <div className="space-y-2">
          <Label>Active Provider</Label>
          <div className="flex items-center gap-2">
            {providerName ? (
              <>
                <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800">
                  {providerName}
                </Badge>
                <span className="text-xs text-muted-foreground">Connected</span>
              </>
            ) : (
              <>
                <Badge variant="outline" className="text-muted-foreground">
                  None
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Using default from environment
                </span>
              </>
            )}
          </div>
        </div>

        {/* System prompt */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="system-prompt">Custom System Prompt</Label>
            <span className="text-xs text-muted-foreground">
              {systemPrompt.length}/{MAX_SYSTEM_PROMPT}
            </span>
          </div>
          <Textarea
            id="system-prompt"
            value={systemPrompt}
            onChange={(e) => {
              if (e.target.value.length <= MAX_SYSTEM_PROMPT) {
                setSystemPrompt(e.target.value);
                setDirty(true);
              }
            }}
            placeholder="Enter a custom system prompt for the AI assistant..."
            className="min-h-[120px] font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            This prompt is prepended to every conversation with the AI assistant.
          </p>
        </div>

        {activeIntegration && (
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
