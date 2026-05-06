import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { WorkspaceTabs } from "./components/workspace-tabs";
import { ArrowLeft, Github, GitBranch, Settings2 } from "lucide-react";
import { Suspense } from "react";

interface ServiceIntegration {
  service: string;
  label: string;
  status: string;
  external_user_id: string | null;
}

interface DevProject {
  id: string;
  name: string;
  description: string | null;
  default_repo_ref: string | null;
  default_jira_project: string | null;
  integrations: ServiceIntegration[];
}

async function getProject(projectId: string): Promise<DevProject | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  if (!profile?.tenant_id) return null;

  const { data: project } = await supabase
    .from("chainthings_dev_projects")
    .select("id, name, description, default_repo_ref, default_jira_project")
    .eq("id", projectId)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (!project) return null;

  const { data: integrations } = await supabase
    .from("chainthings_integrations")
    .select("service, label, status, config")
    .eq("dev_project_id", projectId)
    .eq("tenant_id", profile.tenant_id);

  const mappedIntegrations: ServiceIntegration[] = (integrations ?? []).map((i) => ({
    service: i.service,
    label: i.label,
    status: i.status,
    external_user_id:
      (i.config as { external_user_id?: string | null } | null)?.external_user_id ?? null,
  }));

  return { ...project, integrations: mappedIntegrations };
}

function SvcIcon({ service }: { service: string }) {
  if (service === "github") return <Github className="h-3 w-3" />;
  if (service === "gitlab") return <GitBranch className="h-3 w-3" />;
  return <Settings2 className="h-3 w-3" />;
}

function svcColor(service: string): string {
  if (service === "github") return "bg-zinc-900 text-white border-zinc-900";
  if (service === "gitlab") return "bg-orange-600 text-white border-orange-600";
  return "bg-blue-600 text-white border-blue-600";
}

export default async function DevProjectWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);

  if (!project) notFound();

  return (
    <div className="space-y-6">
      {/* Back nav */}
      <Link
        href="/settings"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Settings
      </Link>

      {/* Workspace header */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
            {project.description && (
              <p className="text-sm text-muted-foreground">{project.description}</p>
            )}
          </div>
        </div>

        {/* Service badges */}
        <div className="flex flex-wrap items-center gap-2">
          {project.integrations.map((intg, idx) => (
            <span
              key={idx}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${svcColor(intg.service)}`}
            >
              <SvcIcon service={intg.service} />
              {intg.label || intg.service}
              <span
                className={`rounded-full px-1 py-px text-[9px] font-medium ${
                  intg.status === "active"
                    ? "bg-green-500/20 text-green-200"
                    : "bg-red-500/20 text-red-200"
                }`}
              >
                {intg.status}
              </span>
            </span>
          ))}

          {project.default_repo_ref && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {project.default_repo_ref}
            </Badge>
          )}
          {project.default_jira_project && (
            <Badge variant="outline" className="text-[10px]">
              {project.default_jira_project}
            </Badge>
          )}

          {project.integrations.length === 0 && (
            <span className="text-xs text-muted-foreground">
              No services connected —{" "}
              <Link href="/settings" className="underline hover:text-primary">
                add in Settings
              </Link>
            </span>
          )}
        </div>
      </div>

      {/* Tabs — wrapped in Suspense because WorkspaceTabs uses useSearchParams */}
      <Suspense fallback={<div className="h-8 w-full animate-pulse rounded-lg bg-muted" />}>
        <WorkspaceTabs
          projectId={project.id}
          defaultRepoRef={project.default_repo_ref}
          defaultJiraProject={project.default_jira_project}
          integrations={project.integrations}
        />
      </Suspense>
    </div>
  );
}
