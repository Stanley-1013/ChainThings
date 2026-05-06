"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GitBranch, ExternalLink, Github } from "lucide-react";

interface RepoItem {
  name: string;
  fullName: string;
  url: string;
  defaultBranch: string;
}

interface Integration {
  service: string;
  status: string;
}

interface ReposTabProps {
  projectId: string;
  integrations: Integration[];
}

export function ReposTab({ projectId, integrations }: ReposTabProps) {
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeIntegration = integrations.find(
    (i) => (i.service === "github" || i.service === "gitlab") && i.status === "active"
  ) ?? integrations.find((i) => i.service === "github" || i.service === "gitlab");

  useEffect(() => {
    if (!codeIntegration) return;

    async function fetchRepos() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/dev-services/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            service: codeIntegration!.service,
            action: "list_repos",
            params: {},
          }),
        });
        const json = (await res.json()) as { data?: RepoItem[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to list repos");
        setRepos(Array.isArray(json.data) ? json.data : []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    void fetchRepos();
  }, [projectId, codeIntegration]);

  if (!codeIntegration) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Github className="h-10 w-10 text-muted-foreground mb-4" />
        <p className="text-sm font-medium">No code integration connected</p>
        <p className="text-xs text-muted-foreground mt-1">
          Connect GitHub or GitLab in Settings to list repos.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (repos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <GitBranch className="h-10 w-10 text-muted-foreground mb-4" />
        <p className="text-sm font-medium">No repositories found</p>
        <p className="text-xs text-muted-foreground mt-1">
          No repositories are accessible via the connected {codeIntegration.service} token.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {repos.map((repo) => (
        <Card key={repo.fullName}>
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{repo.fullName || repo.name}</p>
              <div className="mt-1 flex items-center gap-2">
                <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground font-mono">
                  {repo.defaultBranch}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className="text-[10px] capitalize">
                {codeIntegration.service}
              </Badge>
              {repo.url && (
                <a
                  href={repo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors"
                  aria-label={`Open ${repo.name} in browser`}
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
