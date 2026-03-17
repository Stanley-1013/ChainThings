"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState, useRef, useCallback } from "react";
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
  Loader2,
  PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ConversationSidebar } from "@/components/chat/conversation-sidebar";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { MessageActions } from "@/components/chat/message-actions";
import { RagSources, type RagSource } from "@/components/chat/rag-sources";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  sources?: RagSource[];
}

interface N8nResult {
  name: string;
  n8nWorkflowId: string | null;
  status: string;
}

function LoadingDots() {
  return (
    <div className="flex space-x-1 items-center h-6">
      <div className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.3s]" />
      <div className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.15s]" />
      <div className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce" />
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    if (!isNew && conversationId) {
      loadMessages();
    }
    setCurrentConvId(isNew ? null : conversationId);
    if (isNew) {
      setMessages([]);
      setN8nResults([]);
    }
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const loadMessages = useCallback(async () => {
    const { data } = await supabase
      .from("chainthings_messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (data) setMessages(data as Message[]);
  }, [conversationId, supabase]);

  async function sendMessage(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setLoading(true);

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
      if (!res.ok) throw new Error(data.error || "Failed to send message");

      if (!currentConvId && data.conversationId) {
        setCurrentConvId(data.conversationId);
        router.replace(`/chat/${data.conversationId}`);
      }

      if (data.n8n) {
        setN8nResults((prev) => [...prev, data.n8n]);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.message,
          created_at: new Date().toISOString(),
          sources: data.sources,
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

  const handleRegenerate = () => {
    const lastUserMsg = [...messages]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUserMsg) return;

    // Remove last assistant message
    setMessages((prev) => {
      const idx = prev.findLastIndex((m) => m.role === "assistant");
      if (idx === -1) return prev;
      return prev.filter((_, i) => i !== idx);
    });

    setInput(lastUserMsg.content);
    setTimeout(() => {
      setInput("");
      setLoading(true);

      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: lastUserMsg.content,
          conversationId: currentConvId,
          tool: activeTool,
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.n8n) setN8nResults((prev) => [...prev, data.n8n]);
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: data.message || data.error || "No response",
              created_at: new Date().toISOString(),
              sources: data.sources,
            },
          ]);
        })
        .catch(() => {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "Error: Failed to regenerate response",
              created_at: new Date().toISOString(),
            },
          ]);
        })
        .finally(() => setLoading(false));
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] -mx-4 md:-mx-6 lg:-mx-8">
      {/* Desktop sidebar */}
      {sidebarOpen && (
        <div className="hidden lg:flex w-72 border-r shrink-0">
          <ConversationSidebar
            currentConversationId={currentConvId}
            onCollapse={() => setSidebarOpen(false)}
          />
        </div>
      )}

      {/* Mobile sidebar (sheet) */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="p-0 w-80" showCloseButton={false}>
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          <ConversationSidebar
            currentConversationId={currentConvId}
            onCollapse={() => setMobileSidebarOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 px-4 md:px-6 lg:px-8">
        {/* Top bar */}
        <div className="flex items-center gap-2 py-2 border-b mb-2">
          {!sidebarOpen && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hidden lg:flex"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 lg:hidden"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Open conversations"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>

          {activeTool === "n8n" && (
            <div className="flex items-center gap-2 px-3 py-1 bg-orange-50 dark:bg-orange-950 border border-orange-100 dark:border-orange-800 rounded-lg text-sm text-orange-800 dark:text-orange-200">
              <Zap className="h-3.5 w-3.5 text-orange-500 fill-orange-500" />
              <span className="font-semibold text-xs">n8n mode</span>
            </div>
          )}

          {n8nResults.length > 0 && (
            <div className="flex flex-wrap gap-1.5 ml-auto">
              {n8nResults.map((r, i) => (
                <Badge
                  key={i}
                  variant="secondary"
                  className="pl-1 pr-2 py-0.5 flex items-center gap-1 bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200 border-green-100 dark:border-green-800 text-xs"
                >
                  <div className="p-0.5 bg-green-200 dark:bg-green-800 rounded-full">
                    <Zap className="h-2.5 w-2.5 text-green-700 dark:text-green-300" />
                  </div>
                  <span className="max-w-[120px] truncate">{r.name}</span>
                  {r.n8nWorkflowId && (
                    <a
                      href={`http://localhost:5678/workflow/${r.n8nWorkflowId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-0.5 hover:text-primary"
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 mb-2">
          <div className="space-y-6 py-4 max-w-3xl mx-auto">
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
                  "group/message flex items-start gap-3",
                  msg.role === "user" ? "flex-row-reverse" : "flex-row"
                )}
              >
                <div
                  className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center shrink-0 border",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}
                >
                  {msg.role === "user" ? (
                    <UserIcon className="h-4 w-4" />
                  ) : (
                    <Bot className="h-4 w-4" />
                  )}
                </div>

                <div
                  className={cn(
                    "max-w-[85%] md:max-w-[75%]",
                    msg.role === "user" ? "text-right" : "text-left"
                  )}
                >
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-2.5 text-sm shadow-sm inline-block text-left",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-none"
                        : "bg-muted text-foreground rounded-tl-none"
                    )}
                  >
                    {msg.role === "assistant" ? (
                      <MarkdownRenderer content={msg.content} />
                    ) : (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    )}
                  </div>

                  {/* Actions + Sources below bubble */}
                  <div
                    className={cn(
                      "flex items-center gap-2 mt-1",
                      msg.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    <MessageActions
                      content={msg.content}
                      role={msg.role as "user" | "assistant"}
                      onRegenerate={
                        msg.role === "assistant" ? handleRegenerate : undefined
                      }
                    />
                  </div>

                  {msg.sources && msg.sources.length > 0 && (
                    <RagSources sources={msg.sources} />
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

        {/* Input */}
        <div className="pt-2 pb-2 border-t bg-background">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-2 mb-2">
              <Button
                variant={activeTool === "n8n" ? "default" : "secondary"}
                size="sm"
                onClick={() =>
                  setActiveTool(activeTool === "n8n" ? null : "n8n")
                }
                className={cn(
                  "h-7 text-[10px] uppercase tracking-wider font-bold",
                  activeTool === "n8n" &&
                    "bg-orange-500 hover:bg-orange-600 text-white"
                )}
              >
                <Zap
                  className={cn(
                    "h-3 w-3 mr-1",
                    activeTool === "n8n" && "fill-current"
                  )}
                />
                n8n tool
              </Button>
            </div>

            <form onSubmit={sendMessage} className="relative">
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
                className="absolute right-2.5 bottom-2.5 h-8 w-8 rounded-lg"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </form>
            <p className="text-[10px] text-center text-muted-foreground mt-2">
              AI can make mistakes. Check important info.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
