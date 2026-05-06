"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, ExternalLink, Link2 } from "lucide-react";

interface ServiceLink {
  id: string;
  sourceService: string;
  sourceType: string;
  sourceRef: string;
  sourceUrl: string;
  targetService: string;
  targetType: string;
  targetRef: string;
  targetUrl: string;
  linkType: string;
  status: string;
  createdAt: string;
}

interface LinksTabProps {
  projectId: string;
}

function svcColor(service: string): string {
  if (service === "github") return "bg-zinc-900 text-white";
  if (service === "gitlab") return "bg-orange-600 text-white";
  if (service === "jira") return "bg-blue-600 text-white";
  return "bg-muted text-foreground";
}

function LinkEndpoint({
  service,
  type,
  ref: refVal,
  url,
}: {
  service: string;
  type: string;
  ref: string;
  url: string;
}) {
  const content = (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${svcColor(service)}`}
    >
      {service}:{refVal}
      {url && <ExternalLink className="h-2.5 w-2.5 opacity-70" />}
    </span>
  );

  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" title={`${type} — ${refVal}`}>
        {content}
      </a>
    );
  }
  return <span title={`${type} — ${refVal}`}>{content}</span>;
}

export function LinksTab({ projectId }: LinksTabProps) {
  const [links, setLinks] = useState<ServiceLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchLinks() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/dev-services/projects/${projectId}/links`);
        const json = (await res.json()) as { data?: ServiceLink[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to fetch links");
        setLinks(Array.isArray(json.data) ? json.data : []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    void fetchLinks();
  }, [projectId]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (links.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Link2 className="h-10 w-10 text-muted-foreground mb-4" />
        <p className="text-sm font-medium">No cross-service links yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Sync a PR to Jira to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {links.map((link) => (
        <Card key={link.id}>
          <CardContent className="flex items-center gap-3 p-4 flex-wrap">
            <LinkEndpoint
              service={link.sourceService}
              type={link.sourceType}
              ref={link.sourceRef}
              url={link.sourceUrl}
            />
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            <LinkEndpoint
              service={link.targetService}
              type={link.targetType}
              ref={link.targetRef}
              url={link.targetUrl}
            />
            <div className="ml-auto flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] capitalize">
                {link.linkType}
              </Badge>
              {link.status && (
                <Badge
                  variant={link.status === "active" ? "default" : "secondary"}
                  className="text-[10px]"
                >
                  {link.status}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
