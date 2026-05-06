"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { ExternalLink, Loader2, TicketCheck } from "lucide-react";

interface IssueItem {
  key: string;
  title: string;
  status: string;
  url: string;
}

interface IssuesTabProps {
  projectId: string;
  defaultProjectRef: string | null;
  defaultRepoRef: string | null;
  integrations: { service: string }[];
}

function statusVariant(status: string): "default" | "secondary" | "outline" {
  const s = status.toLowerCase();
  if (s.includes("done") || s.includes("closed") || s.includes("merged")) return "default";
  if (s.includes("progress") || s.includes("review")) return "secondary";
  return "outline";
}

export function IssuesTab({
  projectId,
  defaultProjectRef,
  defaultRepoRef,
  integrations,
}: IssuesTabProps) {
  const placeholder = defaultProjectRef || defaultRepoRef || "PROJ or owner/repo";
  const issueService =
    integrations.find((i) => i.service === "jira")?.service ??
    integrations.find((i) => i.service === "github" || i.service === "gitlab")?.service ??
    "github";

  const [projectRef, setProjectRef] = useState(defaultProjectRef ?? defaultRepoRef ?? "");
  const [issues, setIssues] = useState<IssueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  async function listIssues() {
    if (!projectRef.trim()) return;
    setLoading(true);
    setError(null);
    setFetched(false);
    try {
      const res = await fetch("/api/dev-services/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          service: issueService,
          action: "list_issues",
          params: { projectRef: projectRef.trim(), limit: 50 },
        }),
      });
      const json = (await res.json()) as { data?: IssueItem[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to list issues");
      setIssues(Array.isArray(json.data) ? json.data : []);
      setFetched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="issues-ref" className="text-xs">
            Project ref or repo (owner/repo)
          </Label>
          <Input
            id="issues-ref"
            placeholder={placeholder}
            value={projectRef}
            onChange={(e) => setProjectRef(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void listIssues()}
          />
        </div>
        <div className="flex items-end">
          <Button onClick={() => void listIssues()} disabled={loading || !projectRef.trim()}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            List Issues
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!loading && fetched && issues.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <TicketCheck className="h-10 w-10 text-muted-foreground mb-4" />
          <p className="text-sm font-medium">No issues found</p>
          <p className="text-xs text-muted-foreground mt-1">
            Try a different project ref or check your integration status.
          </p>
        </div>
      )}

      {!loading && issues.length > 0 && (
        <div className="space-y-2">
          {issues.map((issue) => (
            <Card key={issue.key}>
              <CardContent className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      {issue.key}
                    </span>
                    <span className="text-sm font-medium truncate">{issue.title}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={statusVariant(issue.status)} className="text-[10px]">
                    {issue.status}
                  </Badge>
                  {issue.url && (
                    <a
                      href={issue.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-primary transition-colors"
                      aria-label={`Open ${issue.key}`}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
