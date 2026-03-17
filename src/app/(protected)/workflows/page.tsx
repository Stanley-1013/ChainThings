"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Zap, 
  Plus, 
  Loader2, 
  Clock,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { toast } from "sonner";
// cn utility available if needed

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  n8n_workflow_id: string | null;
  created_at: string;
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  const loadWorkflows = useCallback(async () => {
    const { data } = await supabase
      .from("chainthings_workflows")
      .select("id, name, description, status, n8n_workflow_id, created_at")
      .order("created_at", { ascending: false })
      .range(0, 49);

    if (data) setWorkflows(data as Workflow[]);
  }, []);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || generating) return;

    setGenerating(true);
    const toastId = toast.loading("Generating your workflow...");

    try {
      const res = await fetch("/api/workflows/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Generation failed");
      }

      toast.success("Workflow generated and pushed to n8n", { id: toastId });
      setPrompt("");
      await loadWorkflows();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed", { id: toastId });
    } finally {
      setGenerating(false);
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-500 hover:bg-green-600"><CheckCircle2 className="mr-1 h-3 w-3" /> Active</Badge>;
      case "pending":
        return <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" /> Pending</Badge>;
      case "generating":
        return <Badge variant="outline" className="animate-pulse border-blue-500 text-blue-500"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Generating</Badge>;
      case "error":
        return <Badge variant="destructive"><AlertCircle className="mr-1 h-3 w-3" /> Error</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader title="Workflows" description="Automate your tasks with AI-generated n8n workflows" />

      <Card className="bg-muted/30 border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary fill-primary" />
            Create New Workflow
          </CardTitle>
          <CardDescription>
            Describe the automation you need, and our AI will build the n8n nodes for you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleGenerate} className="space-y-4">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., 'A webhook that receives a JSON payload from a form and sends an email notification with the details'"
              className="min-h-[100px] bg-background"
              disabled={generating}
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={generating || !prompt.trim()}>
                {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                {generating ? "Generating..." : "Generate Workflow"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Your Workflows</h2>
        
        {workflows.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {workflows.map((wf) => (
              <Card key={wf.id} className="group hover:border-primary/50 transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <CardTitle className="text-base group-hover:text-primary transition-colors">{wf.name}</CardTitle>
                      {wf.description && (
                        <CardDescription className="line-clamp-2 text-xs">
                          {wf.description}
                        </CardDescription>
                      )}
                    </div>
                    {getStatusBadge(wf.status)}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      {new Date(wf.created_at).toLocaleDateString()}
                    </div>
                    {wf.n8n_workflow_id && (
                      <span className="text-xs text-muted-foreground font-mono">
                        n8n: {wf.n8n_workflow_id}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState 
            icon={Zap}
            title="No workflows yet"
            description="You haven't created any automations. Use the generator above to build your first n8n workflow."
          />
        )}
      </div>
    </div>
  );
}
