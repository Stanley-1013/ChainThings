"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { BotMessageSquare, ExternalLink } from "lucide-react";

interface CodeReview {
  id: string;
  repo_ref: string | null;
  mr_ref: string | null;
  status: string;
  created_at: string;
}

interface ReviewsTabProps {
  projectId: string;
}

function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "completed") return "default";
  if (status === "pending" || status === "running") return "secondary";
  return "outline";
}

export function ReviewsTab({ projectId }: ReviewsTabProps) {
  const [reviews, setReviews] = useState<CodeReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchReviews() {
      setLoading(true);
      setError(null);
      try {
        const supabase = createClient();
        const { data, error: dbErr } = await supabase
          .from("chainthings_code_reviews")
          .select("id, repo_ref, mr_ref, status, created_at")
          .eq("dev_project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (dbErr) throw new Error(dbErr.message);
        setReviews(data ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    void fetchReviews();
  }, [projectId]);

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
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <BotMessageSquare className="h-10 w-10 text-muted-foreground mb-4" />
        <p className="text-sm font-medium">No reviews yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Try Run AI Review on a PR to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reviews.map((review) => (
        <Card key={review.id}>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {review.repo_ref && (
                  <span className="text-sm font-mono text-muted-foreground">
                    {review.repo_ref}
                  </span>
                )}
                {review.mr_ref && (
                  <span className="text-xs text-muted-foreground">#{review.mr_ref}</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(review.created_at).toLocaleString()}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant={statusVariant(review.status)} className="text-[10px] capitalize">
                {review.status}
              </Badge>
              <Button asChild size="sm" variant="ghost" className="h-7 gap-1 text-xs">
                <Link href={`/dev-projects/${projectId}/reviews/${review.id}`}>
                  Open
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
