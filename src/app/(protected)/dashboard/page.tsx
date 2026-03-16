import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { NotificationPanel } from "@/components/shared/notification-panel";
import {
  MessageSquare,
  FolderOpen,
  Zap,
  FileText,
  ExternalLink
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch counts
  const [
    { count: conversationCount },
    { count: fileCount },
    { count: workflowCount },
    { count: itemCount },
  ] = await Promise.all([
    supabase.from("chainthings_conversations").select("*", { count: "exact", head: true }),
    supabase.from("chainthings_files").select("*", { count: "exact", head: true }),
    supabase.from("chainthings_workflows").select("*", { count: "exact", head: true }),
    supabase.from("chainthings_items").select("*", { count: "exact", head: true }),
  ]);

  const displayName = user?.user_metadata?.display_name || user?.email || "User";

  return (
    <div className="space-y-8">
      <PageHeader 
        title="Dashboard" 
        description={`Welcome back, ${displayName}`} 
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Conversations" 
          value={conversationCount || 0} 
          icon={MessageSquare} 
          description="Total active chats"
        />
        <StatCard 
          title="Files" 
          value={fileCount || 0} 
          icon={FolderOpen} 
          description="Uploaded documents"
        />
        <StatCard 
          title="Workflows" 
          value={workflowCount || 0} 
          icon={Zap} 
          description="n8n automations"
        />
        <StatCard 
          title="Meeting Notes" 
          value={itemCount || 0} 
          icon={FileText} 
          description="Processed notes"
        />
      </div>

      <NotificationPanel />

      <div className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">External Services</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="hover:border-primary/50 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Supabase Studio
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
              <CardDescription>Database, Auth, Storage</CardDescription>
            </CardHeader>
            <CardContent>
              <a
                href="http://localhost:8000"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-primary hover:underline"
              >
                Open Studio
              </a>
            </CardContent>
          </Card>

          <Card className="hover:border-primary/50 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                n8n
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
              <CardDescription>Workflow automation</CardDescription>
            </CardHeader>
            <CardContent>
              <a
                href="http://localhost:5678"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-primary hover:underline"
              >
                Open n8n
              </a>
            </CardContent>
          </Card>

          <Card className="hover:border-primary/50 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                OpenClaw
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
              <CardDescription>AI agent gateway</CardDescription>
            </CardHeader>
            <CardContent>
              <a
                href="http://localhost:18789"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-primary hover:underline"
              >
                Open Gateway
              </a>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
