"use client";

import * as React from "react";
import Link from "next/link";
import { Github, GitBranch, Loader2, Trash2, Plus, ChevronDown, ChevronRight, Copy, Check, AlertCircle, Settings2, Webhook, ExternalLink, ArrowUpRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServiceIntegration { id: string; service: string; label: string; status: string; external_user_id: string; webhook_url?: string; }
interface DevProject {
  id: string; name: string; description: string | null; context_notes: string | null;
  default_repo_ref: string | null; default_jira_project: string | null;
  metadata: Record<string, unknown> | null; created_at: string; updated_at: string;
  integrations: ServiceIntegration[];
}
interface ProjectForm { name: string; description: string; context_notes: string; default_repo_ref: string; default_jira_project: string; }
type ServiceType = "github" | "gitlab" | "jira";
interface ConnectForm {
  service: ServiceType; label: string;
  jira_domain: string; jira_email: string; api_token: string; jira_projects: string;
  status_mapping_opened: string; status_mapping_merged: string;
  access_token: string; auto_review_enabled: boolean; auto_review_repos: string; review_language: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const emptyProject = (): ProjectForm => ({ name: "", description: "", context_notes: "", default_repo_ref: "", default_jira_project: "" });
const emptyConnect = (): ConnectForm => ({ service: "github", label: "", jira_domain: "", jira_email: "", api_token: "", jira_projects: "", status_mapping_opened: "", status_mapping_merged: "", access_token: "", auto_review_enabled: false, auto_review_repos: "", review_language: "en" });
const svcColor = (s: string) => s === "github" ? "bg-zinc-900 text-white" : s === "gitlab" ? "bg-orange-600 text-white" : "bg-blue-600 text-white";

function SvcIcon({ s }: { s: string }) {
  if (s === "github") return <Github className="h-3.5 w-3.5" />;
  if (s === "gitlab") return <GitBranch className="h-3.5 w-3.5" />;
  return <Settings2 className="h-3.5 w-3.5" />;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge className="bg-green-600 text-white hover:bg-green-700 text-[10px] px-1.5 py-0">active</Badge>;
  if (status === "expired") return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">expired</Badge>;
  return <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{status}</Badge>;
}

function SvcBadge({ i }: { i: ServiceIntegration }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", svcColor(i.service))}>
      <SvcIcon s={i.service} />{i.label || i.service}<StatusBadge status={i.status || "active"} />
    </span>
  );
}

function CopyBtn({ value }: { value: string }) {
  const [ok, setOk] = React.useState(false);
  return (
    <Button variant="outline" size="icon" className="h-7 w-7 shrink-0"
      onClick={() => { void navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 2000); }}>
      {ok ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function ErrBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="h-4 w-4 shrink-0" />{msg}
    </div>
  );
}

// ─── Project Form Fields ──────────────────────────────────────────────────────

function ProjectFormFields({ form, set }: { form: ProjectForm; set: (p: Partial<ProjectForm>) => void }) {
  return (
    <div className="space-y-3 py-1">
      <div className="space-y-1.5">
        <Label htmlFor="pf-name">Name <span className="text-destructive">*</span></Label>
        <Input id="pf-name" maxLength={100} placeholder="Client Alpha" value={form.name} onChange={e => set({ name: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pf-desc">Description</Label>
        <Textarea id="pf-desc" rows={2} placeholder="Brief description" value={form.description} onChange={e => set({ description: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pf-ctx">Workflow Context <span className="font-normal text-muted-foreground">(AI hint)</span></Label>
        <Textarea id="pf-ctx" rows={3} placeholder="e.g. Jira states: Backlog → In Dev → Review → Done" value={form.context_notes} onChange={e => set({ context_notes: e.target.value })} />
        <p className="text-[11px] text-muted-foreground">Context for the AI — describe your Jira states, branch naming, team conventions.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pf-repo">Default Repo</Label>
          <Input id="pf-repo" placeholder="owner/repo" value={form.default_repo_ref} onChange={e => set({ default_repo_ref: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-jira">Default Jira Project</Label>
          <Input id="pf-jira" placeholder="ALPHA" value={form.default_jira_project} onChange={e => set({ default_jira_project: e.target.value.toUpperCase() })} />
        </div>
      </div>
    </div>
  );
}

// ─── Connect Service Dialog ───────────────────────────────────────────────────

function ConnectDialog({ projectId, open, onOpenChange, onSuccess }: { projectId: string; open: boolean; onOpenChange: (v: boolean) => void; onSuccess: () => Promise<void> }) {
  const [form, setForm] = React.useState<ConnectForm>(emptyConnect);
  const [busy, setBusy] = React.useState(false);
  const [webhookUrl, setWebhookUrl] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const patch = (p: Partial<ConnectForm>) => setForm(prev => ({ ...prev, ...p }));

  const close = (v: boolean) => { if (!v) { setForm(emptyConnect()); setWebhookUrl(null); setErr(null); } onOpenChange(v); };
  const canSubmit = form.service === "jira" ? !!(form.jira_domain && form.jira_email && form.api_token) : !!form.access_token;

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const body: Record<string, unknown> = {
        service: form.service, label: form.label || undefined,
        auto_review_enabled: form.auto_review_enabled, review_language: form.review_language,
      };
      if (form.auto_review_repos.trim()) body.auto_review_repos = form.auto_review_repos.split(",").map(s => s.trim()).filter(Boolean);
      if (form.service === "jira") {
        Object.assign(body, { jira_domain: form.jira_domain, jira_email: form.jira_email, api_token: form.api_token });
        if (form.jira_projects.trim()) body.jira_projects = form.jira_projects.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
        const statusMapping: { mr_opened?: string; mr_merged?: string } = {};
        if (form.status_mapping_opened.trim()) statusMapping.mr_opened = form.status_mapping_opened.trim();
        if (form.status_mapping_merged.trim()) statusMapping.mr_merged = form.status_mapping_merged.trim();
        body.status_mapping = statusMapping;
      } else {
        body.access_token = form.access_token;
      }
      const res = await fetch(`/api/dev-services/projects/${projectId}/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as { error?: string; webhook_url?: string };
      if (!res.ok) throw new Error(json.error ?? "Connection failed");
      if (json.webhook_url) { setWebhookUrl(json.webhook_url); } else { close(false); }
      await onSuccess();
    } catch (e) { setErr(e instanceof Error ? e.message : "Unknown error"); }
    finally { setBusy(false); }
  };

  const svcLabel = (s: ServiceType) => s === "github" ? "GitHub PAT" : s === "gitlab" ? "GitLab PAT" : "Jira API";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect a Service</DialogTitle>
          <DialogDescription>Add a credential to this dev project.</DialogDescription>
        </DialogHeader>

        {!webhookUrl ? (
          <>
            <div className="flex gap-2 pt-1">
              {(["github", "gitlab", "jira"] as ServiceType[]).map(s => (
                <button key={s} type="button" aria-pressed={form.service === s} onClick={() => patch({ service: s })}
                  className={cn("flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors", form.service === s ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground hover:bg-muted/50")}>
                  {svcLabel(s)}
                </button>
              ))}
            </div>
            <div className="space-y-3 py-1">
              <div className="space-y-1.5">
                <Label htmlFor="cf-label">Label (optional)</Label>
                <Input id="cf-label" placeholder={form.service === "jira" ? "my-company (dev@example.com)" : "My PAT"} value={form.label} onChange={e => patch({ label: e.target.value })} />
              </div>
              {form.service === "jira" && (<>
                <div className="space-y-1.5">
                  <Label htmlFor="cf-jdomain">Jira Domain</Label>
                  <div className="flex items-center gap-2">
                    <Input id="cf-jdomain" placeholder="my-company" value={form.jira_domain} onChange={e => patch({ jira_domain: e.target.value })} />
                    <span className="shrink-0 text-xs text-muted-foreground">.atlassian.net</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cf-jemail">Email</Label>
                  <Input id="cf-jemail" type="email" placeholder="dev@company.com" value={form.jira_email} onChange={e => patch({ jira_email: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cf-jtoken">API Token</Label>
                  <Input id="cf-jtoken" type="password" placeholder="ATATT..." value={form.api_token} onChange={e => patch({ api_token: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cf-jprojs">Jira Projects <span className="font-normal text-muted-foreground">(comma-separated)</span></Label>
                  <Input id="cf-jprojs" placeholder="ALPHA, BETA" value={form.jira_projects} onChange={e => patch({ jira_projects: e.target.value })} />
                </div>
                <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Jira Status Mapping</p>
                  <p className="text-[11px] text-muted-foreground">Jira workflow status names. Leave blank to use defaults.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="cf-sm-opened" className="text-xs">Status when PR opened</Label>
                      <Input id="cf-sm-opened" className="h-8 text-xs" placeholder="In Review" maxLength={100} value={form.status_mapping_opened} onChange={e => patch({ status_mapping_opened: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cf-sm-merged" className="text-xs">Status when PR merged</Label>
                      <Input id="cf-sm-merged" className="h-8 text-xs" placeholder="Done" maxLength={100} value={form.status_mapping_merged} onChange={e => patch({ status_mapping_merged: e.target.value })} />
                    </div>
                  </div>
                </div>
              </>)}
              {(form.service === "github" || form.service === "gitlab") && (
                <div className="space-y-1.5">
                  <Label htmlFor="cf-pat">Personal Access Token</Label>
                  <Input id="cf-pat" type="password" placeholder={form.service === "github" ? "ghp_..." : "glpat-..."} value={form.access_token} onChange={e => patch({ access_token: e.target.value })} />
                </div>
              )}
              <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Automation Options</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">AI Auto Review</p>
                    <p className="text-[11px] text-muted-foreground">Draft reviews for new PRs</p>
                  </div>
                  <Checkbox checked={form.auto_review_enabled} onCheckedChange={v => patch({ auto_review_enabled: !!v })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cf-repos" className="text-xs">Repos to review <span className="font-normal text-muted-foreground">(comma-separated, optional)</span></Label>
                  <Input id="cf-repos" className="h-8 text-xs" placeholder="owner/repo, owner/repo2" value={form.auto_review_repos} onChange={e => patch({ auto_review_repos: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cf-lang" className="text-xs">Review Language</Label>
                  <select id="cf-lang" className="flex h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring" value={form.review_language} onChange={e => patch({ review_language: e.target.value })}>
                    <option value="en">English</option>
                    <option value="zh-TW">繁體中文</option>
                    <option value="ja">日本語</option>
                  </select>
                </div>
              </div>
            </div>
            {err && <ErrBanner msg={err} />}
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
              <Button onClick={() => void submit()} disabled={busy || !canSubmit}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Connect
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
              <Check className="h-4 w-4 shrink-0 text-green-600" />
              <p className="text-sm text-green-800 dark:text-green-200">Service connected successfully!</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Webhook URL</Label>
              <div className="flex gap-2">
                <code className="flex-1 break-all rounded-lg border bg-muted px-3 py-2 text-[12px] font-mono">{webhookUrl}</code>
                <CopyBtn value={webhookUrl} />
              </div>
              <div className="flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>Paste this URL into your <strong>{form.service === "jira" ? "Jira" : form.service === "gitlab" ? "GitLab" : "GitHub"}</strong> webhook settings to enable event delivery.</p>
              </div>
            </div>
            <DialogFooter><Button onClick={() => close(false)}>Done</Button></DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Project Detail (expanded) ────────────────────────────────────────────────

function ProjectDetail({ project, onAddCred }: { project: DevProject; onAddCred: () => void }) {
  return (
    <div className="border-t bg-muted/10 px-4 pb-4 pt-3 space-y-3">
      {project.integrations.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Connected Services</p>
          {project.integrations.map((intg, idx) => (
            <div key={idx} className="rounded-lg border bg-background px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn("flex h-7 w-7 items-center justify-center rounded-md text-white text-xs", svcColor(intg.service))}>
                    <SvcIcon s={intg.service} />
                  </span>
                  <div>
                    <p className="text-xs font-medium capitalize">{intg.label || intg.service}</p>
                    {intg.external_user_id && <p className="text-[10px] text-muted-foreground">{intg.external_user_id}</p>}
                  </div>
                </div>
                <StatusBadge status={intg.status || "active"} />
              </div>
              {intg.webhook_url && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Webhook URL</p>
                  <div className="flex gap-1.5">
                    <code className="flex-1 break-all rounded border bg-muted px-2 py-1 text-[10px] font-mono leading-relaxed">{intg.webhook_url}</code>
                    <CopyBtn value={intg.webhook_url} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No services connected yet.</p>
      )}
      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={onAddCred}>
        <Plus className="h-3.5 w-3.5" />Add Credential
      </Button>
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────

function ProjectCard({ project, onEdit, onDelete, onRefresh }: { project: DevProject; onEdit: (p: DevProject) => void; onDelete: (p: DevProject) => void; onRefresh: () => Promise<void> }) {
  const [expanded, setExpanded] = React.useState(false);
  const [connectOpen, setConnectOpen] = React.useState(false);
  return (
    <Card className="overflow-hidden">
      <div className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors" onClick={() => setExpanded(v => !v)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{project.name}</span>
            {project.default_repo_ref && <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">{project.default_repo_ref}</Badge>}
            {project.default_jira_project && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{project.default_jira_project}</Badge>}
          </div>
          {project.description && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{project.description}</p>}
          {project.integrations.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {project.integrations.map((intg, idx) => <SvcBadge key={idx} i={intg} />)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={e => e.stopPropagation()}>
            <Link href={`/dev-projects/${project.id}`}>Open <ArrowUpRight className="h-3 w-3" /></Link>
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => { e.stopPropagation(); onEdit(project); }}><Settings2 className="h-3.5 w-3.5" /></Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={e => { e.stopPropagation(); onDelete(project); }}><Trash2 className="h-3.5 w-3.5" /></Button>
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>
      {expanded && <ProjectDetail project={project} onAddCred={() => setConnectOpen(true)} />}
      <ConnectDialog projectId={project.id} open={connectOpen} onOpenChange={setConnectOpen} onSuccess={onRefresh} />
    </Card>
  );
}

// ─── Create / Edit Dialog ─────────────────────────────────────────────────────

function ProjectDialog({ open, onOpenChange, initial, onSuccess }: { open: boolean; onOpenChange: (v: boolean) => void; initial: DevProject | null; onSuccess: () => Promise<void> }) {
  const isEdit = !!initial;
  const [form, setForm] = React.useState<ProjectForm>(emptyProject);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const patch = (p: Partial<ProjectForm>) => setForm(prev => ({ ...prev, ...p }));

  React.useEffect(() => {
    if (open) {
      setForm(initial ? { name: initial.name, description: initial.description ?? "", context_notes: initial.context_notes ?? "", default_repo_ref: initial.default_repo_ref ?? "", default_jira_project: initial.default_jira_project ?? "" } : emptyProject());
      setErr(null);
    }
  }, [open, initial]);

  const submit = async () => {
    if (!form.name.trim()) return;
    setBusy(true); setErr(null);
    try {
      const body = { name: form.name.trim(), description: form.description.trim() || undefined, context_notes: form.context_notes.trim() || undefined, default_repo_ref: form.default_repo_ref.trim() || undefined, default_jira_project: form.default_jira_project.trim() || undefined };
      const res = await fetch(isEdit ? `/api/dev-services/projects/${initial!.id}` : "/api/dev-services/projects", { method: isEdit ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Request failed");
      await onSuccess(); onOpenChange(false);
    } catch (e) { setErr(e instanceof Error ? e.message : "Unknown error"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Dev Project" : "Create Dev Project"}</DialogTitle>
          <DialogDescription>{isEdit ? "Update project settings." : "Group Jira, GitHub, and GitLab credentials under one project."}</DialogDescription>
        </DialogHeader>
        <ProjectFormFields form={form} set={patch} />
        {err && <ErrBanner msg={err} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || !form.name.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{isEdit ? "Save Changes" : "Create Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete Confirmation Dialog ───────────────────────────────────────────────

function DeleteDialog({ project, open, onOpenChange, onSuccess }: { project: DevProject | null; open: boolean; onOpenChange: (v: boolean) => void; onSuccess: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const del = async () => {
    if (!project) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/dev-services/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) { const json = (await res.json()) as { error?: string }; throw new Error(json.error ?? "Delete failed"); }
      await onSuccess(); onOpenChange(false);
    } catch (e) { setErr(e instanceof Error ? e.message : "Unknown error"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{project?.name}&rdquo;?</DialogTitle>
          <DialogDescription>This will permanently delete the project and all its connected credentials. This action cannot be undone.</DialogDescription>
        </DialogHeader>
        {err && <ErrBanner msg={err} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => void del()} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-14 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/5 text-primary">
          <Webhook className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-semibold">No dev projects yet</h3>
        <p className="mx-auto mt-1 max-w-[280px] text-xs text-muted-foreground">Create your first project to connect Jira, GitHub, and GitLab credentials under a single workspace.</p>
        <Button className="mt-5 gap-2" onClick={onCreate}><Plus className="h-4 w-4" />Create Dev Project</Button>
      </CardContent>
    </Card>
  );
}

// ─── Main Section ─────────────────────────────────────────────────────────────

export default function DevServiceSection() {
  const [projects, setProjects] = React.useState<DevProject[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [fetchErr, setFetchErr] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<DevProject | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<DevProject | null>(null);

  const fetchProjects = React.useCallback(async () => {
    try {
      const res = await fetch("/api/dev-services/projects");
      if (!res.ok) throw new Error("Failed to fetch dev projects");
      const json = (await res.json()) as { data?: DevProject[] };
      setProjects(Array.isArray(json.data) ? json.data : []);
      setFetchErr(null);
    } catch (e) { setFetchErr(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { void fetchProjects(); }, [fetchProjects]);

  const lastUpdated = projects.reduce<string | null>((acc, p) => (!acc || p.updated_at > acc ? p.updated_at : acc), null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Developer Services</h2>
          <p className="text-sm text-muted-foreground">
            Group Jira, GitHub, and GitLab credentials by project for AI-driven automation.
            {lastUpdated && <span className="ml-1 text-xs">Updated {formatDistanceToNow(new Date(lastUpdated), { addSuffix: true })}</span>}
          </p>
        </div>
        {projects.length > 0 && (
          <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />New Project
          </Button>
        )}
      </div>

      {fetchErr && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <div className="flex-1 text-sm">{fetchErr}</div>
          <Button variant="outline" size="sm" onClick={() => void fetchProjects()}>Retry</Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />)}</div>
      ) : projects.length === 0 && !fetchErr ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="space-y-3">
          {projects.map(p => (
            <ProjectCard key={p.id} project={p} onEdit={setEditTarget} onDelete={setDeleteTarget} onRefresh={fetchProjects} />
          ))}
        </div>
      )}

      <ProjectDialog open={createOpen} onOpenChange={setCreateOpen} initial={null} onSuccess={fetchProjects} />
      <ProjectDialog open={!!editTarget} onOpenChange={v => !v && setEditTarget(null)} initial={editTarget} onSuccess={fetchProjects} />
      <DeleteDialog project={deleteTarget} open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)} onSuccess={fetchProjects} />
    </div>
  );
}
