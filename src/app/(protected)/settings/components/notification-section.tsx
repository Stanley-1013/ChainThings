"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const FREQUENCIES = [
  { value: "daily", label: "Daily" },
  { value: "every3days", label: "Every 3 days" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
] as const;

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${i.toString().padStart(2, "0")}:00`,
}));

const COMMON_TIMEZONES = [
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Seoul",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Australia/Sydney",
  "Pacific/Auckland",
];

interface NotificationSettings {
  enabled: boolean;
  frequency: string;
  timezone: string;
  send_hour_local: number;
}

export function NotificationSection() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/notifications/settings", { signal: controller.signal })
      .then((r) => r.json())
      .then((json) => setSettings(json.data))
      .catch((err) => { if (err.name !== "AbortError") toast.error("Failed to load notification settings"); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/notifications/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: settings.enabled,
          frequency: settings.frequency,
          timezone: settings.timezone,
          send_hour_local: settings.send_hour_local,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSettings(json.data);
      setDirty(false);
      toast.success("Notification settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const update = (patch: Partial<NotificationSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Notifications
        </CardTitle>
        <CardDescription>
          Configure AI-generated notification summaries
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <div>
            <Label id="notify-toggle-label">Enable Notifications</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Receive AI-powered summaries of your activity
            </p>
          </div>
          <button
            role="switch"
            aria-checked={settings?.enabled}
            aria-labelledby="notify-toggle-label"
            onClick={() => update({ enabled: !settings?.enabled })}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
              settings?.enabled ? "bg-primary" : "bg-muted"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform",
                settings?.enabled ? "translate-x-5" : "translate-x-0"
              )}
            />
          </button>
        </div>

        {/* Frequency */}
        <div className="space-y-2">
          <Label id="frequency-label">Summary Frequency</Label>
          <div role="radiogroup" aria-labelledby="frequency-label" className="flex flex-wrap gap-2">
            {FREQUENCIES.map((f) => (
              <button
                key={f.value}
                role="radio"
                aria-checked={settings?.frequency === f.value}
                onClick={() => update({ frequency: f.value })}
                className={cn(
                  "flex-1 min-w-[80px] rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                  settings?.frequency === f.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-muted"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Timezone */}
        <div className="space-y-2">
          <Label htmlFor="timezone">Timezone</Label>
          <select
            id="timezone"
            value={settings?.timezone || "Asia/Taipei"}
            onChange={(e) => update({ timezone: e.target.value })}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>

        {/* Send time */}
        <div className="space-y-2">
          <Label htmlFor="send-hour">Delivery Time</Label>
          <div className="flex items-center gap-2">
            <select
              id="send-hour"
              value={settings?.send_hour_local ?? 9}
              onChange={(e) => update({ send_hour_local: Number(e.target.value) })}
              className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {HOURS.map((h) => (
                <option key={h.value} value={h.value}>
                  {h.label}
                </option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground">local time</span>
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving || !dirty}>
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </CardContent>
    </Card>
  );
}
