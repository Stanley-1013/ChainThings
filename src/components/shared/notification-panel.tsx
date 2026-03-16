"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bell,
  BellOff,
  Settings2,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import Link from "next/link";

interface NotificationSettings {
  enabled: boolean;
  frequency: string;
  timezone: string;
}

interface NotificationCache {
  id: string;
  period_start: string;
  period_end: string;
  content: {
    summary?: string;
    actionItems?: Array<{ task: string; priority?: string }>;
    reminders?: string[];
  };
  status: string;
  created_at: string;
}

export function NotificationPanel() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [notifications, setNotifications] = useState<NotificationCache[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [settingsRes, notifsRes] = await Promise.all([
        fetch("/api/notifications/settings"),
        fetch("/api/notifications"),
      ]);
      const settingsJson = await settingsRes.json();
      const notifsJson = await notifsRes.json();
      setSettings(settingsJson.data);
      setNotifications(notifsJson.data ?? []);
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function toggleEnabled() {
    if (!settings) return;
    setToggling(true);
    try {
      const res = await fetch("/api/notifications/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, enabled: !settings.enabled }),
      });
      const json = await res.json();
      if (res.ok) setSettings(json.data);
    } finally {
      setToggling(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  const latest = notifications[0];

  return (
    <Card className="border-primary/10">
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Notifications
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleEnabled}
            disabled={toggling}
            className="h-7 text-xs"
          >
            {toggling ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : settings?.enabled ? (
              <Bell className="h-3 w-3 mr-1" />
            ) : (
              <BellOff className="h-3 w-3 mr-1" />
            )}
            {settings?.enabled ? "On" : "Off"}
          </Button>
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {!settings?.enabled ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            <BellOff className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>Notifications are disabled.</p>
            <p className="text-xs mt-1">Enable to receive AI-generated summaries and reminders.</p>
          </div>
        ) : !latest ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>No notifications yet.</p>
            <p className="text-xs mt-1">
              Next digest: {settings.frequency === "daily" ? "Tomorrow" : "This " + settings.frequency.replace("bi", "")} at 09:00
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {latest.content.summary && (
              <p className="text-sm">{latest.content.summary}</p>
            )}

            {latest.content.actionItems && latest.content.actionItems.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Action Items
                </p>
                {latest.content.actionItems.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <span>{item.task}</span>
                    {item.priority && (
                      <Badge
                        variant="outline"
                        className="text-[10px] ml-auto shrink-0"
                      >
                        {item.priority}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}

            {latest.content.reminders && latest.content.reminders.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Reminders
                </p>
                {latest.content.reminders.map((reminder, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                    <span>{reminder}</span>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[10px] text-muted-foreground pt-1">
              {latest.period_start} — {latest.period_end} · {settings.frequency}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
