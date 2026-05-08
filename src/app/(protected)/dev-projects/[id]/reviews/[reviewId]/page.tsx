import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ReviewViewer } from "./components/review-viewer";

interface ReviewPageProps {
  params: Promise<{ id: string; reviewId: string }>;
}

export default async function ReviewPage({ params }: ReviewPageProps) {
  const { id: projectId, reviewId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch tenant_id from profile — tenant_id is the primary isolation guard per coding-style.md.
  // RLS is a safety net only; explicit tenant_id filtering must always be present.
  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile?.tenant_id) {
    redirect("/login");
  }

  const tenantId = profile.tenant_id;

  const { data: review, error } = await supabase
    .from("chainthings_code_reviews")
    .select(
      "id, tenant_id, dev_project_id, integration_id, service, repo_ref, subject_ref, subject_title, subject_url, review_comments, review_status, submitted_at, created_at"
    )
    .eq("id", reviewId)
    .eq("dev_project_id", projectId)
    .eq("tenant_id", tenantId)
    .single();

  if (error || !review) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center">
        <p className="text-2xl font-semibold">Review not found</p>
        <p className="text-sm text-muted-foreground">
          This review doesn&apos;t exist, or you don&apos;t have access to it.
        </p>
        <a
          href={`/dev-projects/${projectId}?tab=reviews`}
          className="text-sm font-medium text-primary hover:underline"
        >
          Back to Workspace
        </a>
      </div>
    );
  }

  return (
    <ReviewViewer
      review={{
        id: review.id,
        service: review.service as "github" | "gitlab",
        repo_ref: review.repo_ref,
        subject_ref: review.subject_ref,
        subject_title: review.subject_title ?? undefined,
        subject_url: review.subject_url ?? undefined,
        review_comments: (review.review_comments ?? []) as ReviewComment[],
        review_status: review.review_status as ReviewStatus,
        submitted_at: review.submitted_at ?? undefined,
        created_at: review.created_at,
      }}
      projectId={projectId}
    />
  );
}

// Type exports for the client component (co-locate for simplicity)
export type ReviewStatus = "draft" | "completed" | "failed" | "submitted";

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
  side?: string;
}
