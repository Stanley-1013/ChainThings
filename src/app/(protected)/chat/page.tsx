import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, Plus, Clock } from "lucide-react";

export default async function ChatListPage() {
  const supabase = await createClient();

  const { data: conversations } = await supabase
    .from("chainthings_conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false });

  function formatRelativeTime(dateString: string) {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) return "Just now";
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    
    return date.toLocaleDateString();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Chat" description="Your AI conversations">
        <Button asChild size="sm">
          <Link href="/chat/new">
            <Plus className="mr-2 h-4 w-4" />
            New conversation
          </Link>
        </Button>
      </PageHeader>

      {conversations && conversations.length > 0 ? (
        <div className="grid grid-cols-1 gap-3">
          {conversations.map((conv) => (
            <Link key={conv.id} href={`/chat/${conv.id}`}>
              <Card className="hover:bg-muted/50 transition-colors border-l-4 border-l-transparent hover:border-l-primary group">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{conv.title}</h3>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                      <Clock className="h-3 w-3" />
                      {formatRelativeTime(conv.updated_at)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState 
          icon={MessageSquare}
          title="No conversations"
          description="Start a new chat with the AI assistant to get help with your tasks."
          action={{
            label: "New conversation",
            href: "/chat/new"
          }}
        />
      )}
    </div>
  );
}
