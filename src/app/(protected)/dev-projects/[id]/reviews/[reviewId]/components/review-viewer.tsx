"use client";

import { useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ReviewComment, ReviewStatus } from "../page";

interface Review {
  id: string;
  service: "github" | "gitlab";
  repo_ref: string;
  subject_ref: string;
  subject_title?: string;
  subject_url?: string;
  review_comments: ReviewComment[];
  review_status: ReviewStatus;
  submitted_at?: string;
  created_at: string;
}

interface ReviewViewerProps {
  review: Review;
  projectId: string;
}

const STATUS_VARIANTS: Record<
  ReviewStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "secondary",
  completed: "default",
  failed: "destructive",
  submitted: "outline",
};

export function ReviewViewer({ review, projectId }: ReviewViewerProps) {
  const comments = review.review_comments;
  const isSubmitted = review.review_status === "submitted";

  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(comments.map((_, i) => i))
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<ReviewStatus>(
    review.review_status
  );
  const [submittedAt, setSubmittedAt] = useState<string | undefined>(
    review.submitted_at
  );

  function toggleAll() {
    if (selected.size === comments.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(comments.map((_, i) => i)));
    }
  }

  function toggleOne(idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const selectedComments = Array.from(selected).map((i) => ({
        path: comments[i].path,
        line: comments[i].line,
        body: comments[i].body,
        ...(comments[i].side ? { side: comments[i].side } : {}),
      }));

      const res = await fetch("/api/dev-services/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          service: review.service,
          action: "submit_review",
          params: {
            reviewId: review.id,
            repoRef: review.repo_ref,
            mrRef: review.subject_ref,
            selectedComments,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error ?? "Failed to submit review");
      }

      const now = new Date().toISOString();
      setCurrentStatus("submitted");
      setSubmittedAt(now);
      setConfirmOpen(false);
      toast.success(
        `${selectedComments.length} comment${selectedComments.length === 1 ? "" : "s"} posted to ${review.service}`
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to submit review"
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Build a PR/MR URL if subject_url is available; fallback to null
  const prUrl = review.subject_url ?? null;

  const formattedDate = new Date(review.created_at).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const submittedDateFormatted = submittedAt
    ? new Date(submittedAt).toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const allSelected = selected.size === comments.length && comments.length > 0;
  const noneSelected = selected.size === 0;
  const submitDisabled =
    noneSelected || currentStatus === "submitted" || submitting;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href={`/dev-projects/${projectId}?tab=reviews`}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Workspace
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            AI Review for{" "}
            <span className="font-mono text-lg">
              {review.repo_ref}#{review.subject_ref}
            </span>
          </h1>
          {prUrl && (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Open PR
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={STATUS_VARIANTS[currentStatus]} className="capitalize">
            {currentStatus}
          </Badge>
          <Badge variant="outline" className="uppercase">
            {review.service}
          </Badge>
          {review.subject_title && (
            <span className="truncate max-w-xs">{review.subject_title}</span>
          )}
          <span>{formattedDate}</span>
        </div>
      </div>

      {/* Already-submitted banner */}
      {currentStatus === "submitted" && submittedDateFormatted && (
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          This review was submitted on {submittedDateFormatted}.{" "}
          {comments.length} comment{comments.length === 1 ? "" : "s"} were
          posted.
        </div>
      )}

      {/* Toolbar */}
      {comments.length > 0 && (
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              disabled={isSubmitted || currentStatus === "submitted"}
            />
            <span className="text-sm font-medium">Select all</span>
          </label>

          <span className="text-sm text-muted-foreground">
            {selected.size} of {comments.length} selected
          </span>

          <Button
            size="sm"
            disabled={submitDisabled}
            onClick={() => setConfirmOpen(true)}
            className="ml-auto"
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit to {review.service}
          </Button>
        </div>
      )}

      {/* Comment list */}
      {comments.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            AI didn&apos;t propose any comments for this PR.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {comments.map((comment, idx) => (
            <Card
              key={idx}
              className={
                selected.has(idx)
                  ? "ring-1 ring-primary/40 bg-primary/5"
                  : undefined
              }
            >
              <CardContent className="py-3 flex gap-3 items-start">
                <Checkbox
                  checked={selected.has(idx)}
                  onCheckedChange={() => toggleOne(idx)}
                  disabled={currentStatus === "submitted"}
                  className="mt-0.5 shrink-0"
                />

                <div className="flex-1 min-w-0 space-y-2">
                  {/* File path + line + side */}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground font-mono">
                    <span className="text-foreground font-semibold break-all">
                      {comment.path}
                    </span>
                    <span>line {comment.line}</span>
                    {comment.side && (
                      <Badge variant="secondary" className="text-[10px]">
                        {comment.side}
                      </Badge>
                    )}
                  </div>

                  {/* Comment body — rendered markdown */}
                  <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
                    <ReactMarkdown>{comment.body}</ReactMarkdown>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Submit review to {review.service}?</DialogTitle>
            <DialogDescription>
              Submit {selected.size} comment
              {selected.size === 1 ? "" : "s"} to {review.service}? They will
              be posted as inline review comments on the PR.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Submit {selected.size} comment
              {selected.size === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
