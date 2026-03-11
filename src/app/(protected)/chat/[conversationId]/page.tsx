"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { 
  Send, 
  Zap, 
  Bot, 
  User as UserIcon, 
  ExternalLink,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

interface N8nResult {
  name: string;
  n8nWorkflowId: string | null;
  status: string;
}

function MessageContent({ content }: { content: string }) {
  // Render n8n workflow blocks as cards
  const parts = content.split(/(```n8n-workflow[\s\S]*?```)/);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```n8n-workflow")) {
          return (
            <Card
              key={i}
              className="my-3 border-green-200 bg-green-50/50 shadow-sm overflow-hidden"
            >
              <CardContent className="p-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-green-100 rounded-md">
                    <Zap className="h-4 w-4 text-green-600" />
                  </div>
                  <span className="text-sm font-semibold text-green-700">
                    Workflow JSON generated
                  </span>
                </div>
                <Badge variant="outline" className="bg-white text-green-700 border-green-200">
                  Ready
                </Badge>
              </CardContent>
            </Card>
          );
        }
        return part ? <span key={i}>{part}</span> : null;
      })}
    </>
  );
}

function LoadingDots() {
  return (
    <div className="flex space-x-1 items-center h-6">
      <div className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.3s]"></div>
      <div className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.15s]"></div>
      <div className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce"></div>
    </div>
  );
}

export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();
  const conversationId = params.conversationId as string;
  const isNew = conversationId === "new";

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [n8nResults, setN8nResults] = useState<N8nResult[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(
    isNew ? null : conversationId
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    if (!isNew && conversationId) {
      loadMessages();
    }
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function loadMessages() {
    const { data } = await supabase
      .from("chainthings_messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (data) setMessages(data as Message[]);
  }

  async function sendMessage(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setLoading(true);

    // Optimistic update
    const tempId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        role: "user",
        content: userMessage,
        created_at: new Date().toISOString(),
      },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          conversationId: currentConvId,
          tool: activeTool,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to send message");
      }

      // If this was a new conversation, update the URL
      if (!currentConvId && data.conversationId) {
        setCurrentConvId(data.conversationId);
        router.replace(`/chat/${data.conversationId}`);
      }

      // Track n8n results
      if (data.n8n) {
        setN8nResults((prev) => [...prev, data.n8n]);
      }

      // Add assistant response
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.message,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Error sending message";
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Error: ${errorMsg}`,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header Info (n8n mode or workflow results) */}
      <div className="flex flex-col gap-2 mb-4">
        {activeTool === "n8n" && (
          <div className="flex items-center gap-2 px-4 py-2 bg-orange-50 border border-orange-100 rounded-lg text-sm text-orange-800 animate-in fade-in slide-in-from-top-1">
            <Zap className="h-4 w-4 text-orange-500 fill-orange-500" />
            <span className="font-semibold">n8n mode active</span>
            <span className="hidden md:inline opacity-80">— Describe the workflow you want, AI will build it.</span>
          </div>
        )}

        {n8nResults.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {n8nResults.map((r, i) => (
              <Badge key={i} variant="secondary" className="pl-1 pr-2 py-1 flex items-center gap-1 bg-green-50 text-green-800 border-green-100">
                <div className="p-0.5 bg-green-200 rounded-full">
                  <Zap className="h-3 w-3 text-green-700" />
                </div>
                <span className="max-w-[150px] truncate">{r.name}</span>
                {r.n8nWorkflowId && (
                  <a
                    href={`http://localhost:5678/workflow/${r.n8nWorkflowId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 hover:text-primary"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 pr-4 mb-4">
        <div className="space-y-6 pb-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center pt-20 text-center opacity-40">
              <Bot className="h-12 w-12 mb-4" />
              <p className="max-w-xs text-sm">
                {activeTool === "n8n"
                  ? 'Describe the workflow you want. e.g., "A webhook that receives data and saves it to a Google Sheet"'
                  : "Send a message to start the conversation."}
              </p>
            </div>
          )}
          
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex items-start gap-3",
                msg.role === "user" ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div className={cn(
                "h-8 w-8 rounded-full flex items-center justify-center shrink-0 border",
                msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
              )}>
                {msg.role === "user" ? <UserIcon className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              </div>
              
              <div
                className={cn(
                  "max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm shadow-sm",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-none"
                    : "bg-muted text-foreground rounded-tl-none"
                )}
              >
                {msg.role === "assistant" ? (
                  <MessageContent content={msg.content} />
                ) : (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}
              </div>
            </div>
          ))}
          
          {loading && (
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-muted border">
                <Bot className="h-4 w-4" />
              </div>
              <div className="bg-muted rounded-2xl rounded-tl-none px-4 py-2.5 shadow-sm min-w-[80px]">
                <LoadingDots />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="mt-auto pt-2 border-t bg-background">
        <div className="flex gap-2 mb-2">
          <Button
            variant={activeTool === "n8n" ? "default" : "secondary"}
            size="sm"
            onClick={() => setActiveTool(activeTool === "n8n" ? null : "n8n")}
            className={cn(
              "h-7 text-[10px] uppercase tracking-wider font-bold",
              activeTool === "n8n" && "bg-orange-500 hover:bg-orange-600 text-white"
            )}
          >
            <Zap className={cn("h-3 w-3 mr-1", activeTool === "n8n" && "fill-current")} />
            n8n tool
          </Button>
        </div>
        
        <form onSubmit={sendMessage} className="relative group">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeTool === "n8n"
                ? "Describe your workflow..."
                : "Type a message..."
            }
            disabled={loading}
            className="min-h-[60px] max-h-[200px] w-full pr-14 py-3 resize-none bg-muted/30 focus:bg-background transition-colors rounded-xl border-muted"
          />
          <Button 
            type="submit" 
            size="icon" 
            disabled={loading || !input.trim()}
            className="absolute right-2.5 bottom-2.5 h-8 w-8 rounded-lg transition-all"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
        <p className="text-[10px] text-center text-muted-foreground mt-2">
          AI can make mistakes. Check important info.
        </p>
      </div>
    </div>
  );
}
