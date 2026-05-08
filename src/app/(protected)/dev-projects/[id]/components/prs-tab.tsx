"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  ExternalLink,
  GitPullRequest,
  BotMessageSquare,
  Link2,
  GitMerge,
} from "lucide-react";
import { toast } from "sonner";

interface PrData {
  title: string;
  body: string;
  branch: string;
  url: string;
  state: string;
  author: string;
}

interface SyncResult {
  event: string;
  linkedTickets: string[];
}

interface PrsTabProps {
  projectId: string;
  defaultRepoRef: string | null;
}

function stateVariant(state: string): "default" | "secondary" | "outline" {
  const s = state.toLowerCase();
  if (s === "merged") return "default";
  if (s === "open") return "secondary";
  return "outline";
}

export function PrsTab({ projectId, defaultRepoRef }: PrsTabProps) {
  const router = useRouter();
  const [repoRef, setRepoRef] = useState(defaultRepoRef ?? "");
  const [mrRef, setMrRef] = useState("");
  const [pr, setPr] = useState<PrData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [syncOpenLoading, setSyncOpenLoading] = useState(false);
  const [syncMergeLoading, setSyncMergeLoading] = useState(false);

  async function fetchPr() {
    if (!repoRef.trim() || !mrRef.trim()) return;
    setLoading(true);
    setError(null);
    setPr(null);
    setSyncResult(null);
    try {
      const res = await fetch("/api/dev-services/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          service: "github",
          action: "get_mr",
          params: { repoRef: repoRef.trim(), mrRef: mrRef.trim() },
        }),
      });
      const json = (await res.json()) as { data?: PrData; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to fetch PR");
      setPr(json.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function runReview() {
    if (!repoRef.trim() || !mrRef.trim()) return;
    setReviewLoading(true);
    try {
      const res = await fetch("/api/dev-services/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          service: "github",
          action: "review_mr",
          params: { repoRef: repoRef.trim(), mrRef: mrRef.trim() },
        }),
      });
      const json = (await res.json()) as { data?: { reviewId: string }; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to start review");
      const reviewId = json.data?.reviewId;
      if (reviewId) {
        router.push(`/dev-projects/${projectId}/reviews/${reviewId}`);
      } else {
        toast.success("Review started");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start review");
    } finally {
      setReviewLoading(false);
    }
  }

  async function syncToJira(event: "mr_opened" | "mr_merged") {
    if (!repoRef.trim() || !mrRef.trim()) return;
    const setLoadingFn = event === "mr_opened" ? setSyncOpenLoading : setSyncMergeLoading;
    setLoadingFn(true);
    // TODO: detect GitLab vs GitHub by inspecting defaultRepoRef/repoRef when GitLab support is added.
    // For now, always use "github" — the backend dispatcher resolves the code-host client from
    // this service field, and only code-host services expose the `branches` capability needed by
    // sync_pr_to_jira. Passing "jira" here causes a 403.
    const codeHostService = "github";
    try {
      const res = await fetch("/api/dev-services/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          service: codeHostService,
          action: "sync_pr_to_jira",
          params: { repoRef: repoRef.trim(), prRef: mrRef.trim(), event },
        }),
      });
      const json = (await res.json()) as {
        data?: { linkedTickets: string[] };
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      const tickets = json.data?.linkedTickets ?? [];
      const result: SyncResult = { event, linkedTickets: tickets };
      setSyncResult(result);
      if (tickets.length > 0) {
        toast.success(`Linked ${tickets.length} ticket${tickets.length > 1 ? "s" : ""}: ${tickets.join(", ")}`);
      } else {
        toast.success("Sync complete — no tickets linked");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setLoadingFn(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pr-repo" className="text-xs">
            Repo ref (owner/repo)
          </Label>
          <Input
            id="pr-repo"
            placeholder="owner/repo"
            value={repoRef}
            onChange={(e) => setRepoRef(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pr-ref" className="text-xs">
            PR / MR number
          </Label>
          <Input
            id="pr-ref"
            placeholder="42"
            value={mrRef}
            onChange={(e) => setMrRef(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void fetchPr()}
          />
        </div>
      </div>

      <Button
        onClick={() => void fetchPr()}
        disabled={loading || !repoRef.trim() || !mrRef.trim()}
      >
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Fetch PR
      </Button>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && <Skeleton className="h-40 w-full rounded-lg" />}

      {!loading && pr && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <CardTitle className="text-base leading-tight">{pr.title}</CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={stateVariant(pr.state)} className="text-[10px]">
                    {pr.state}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">{pr.branch}</span>
                  {pr.author && (
                    <span className="text-xs text-muted-foreground">by {pr.author}</span>
                  )}
                </div>
              </div>
              {pr.url && (
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors shrink-0 mt-1"
                  aria-label="Open PR in browser"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          </CardHeader>
          {pr.body && (
            <CardContent className="pt-0 pb-3">
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap">
                {pr.body}
              </p>
            </CardContent>
          )}
          <CardContent className="pt-0">
            <div className="border-t pt-3 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Actions
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => void runReview()}
                  disabled={reviewLoading}
                >
                  {reviewLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <BotMessageSquare className="h-3.5 w-3.5" />
                  )}
                  Run AI Review
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => void syncToJira("mr_opened")}
                  disabled={syncOpenLoading}
                >
                  {syncOpenLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" />
                  )}
                  Sync to Jira (opened)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => void syncToJira("mr_merged")}
                  disabled={syncMergeLoading}
                >
                  {syncMergeLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <GitMerge className="h-3.5 w-3.5" />
                  )}
                  Sync to Jira (merged)
                </Button>
              </div>
              {syncResult && (
                <div className="mt-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
                  <span className="font-medium capitalize">
                    {syncResult.event.replace("_", " ")}
                  </span>
                  {" — "}
                  {syncResult.linkedTickets.length > 0
                    ? `Linked: ${syncResult.linkedTickets.join(", ")}`
                    : "No tickets linked"}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && !pr && !error && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <GitPullRequest className="h-10 w-10 text-muted-foreground mb-4" />
          <p className="text-sm text-muted-foreground">
            Enter a repo and PR number, then click Fetch PR.
          </p>
        </div>
      )}
    </div>
  );
}
