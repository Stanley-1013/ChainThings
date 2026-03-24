"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState, useRef, useCallback, lazy, Suspense } from "react";
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
  AlertCircle,
  Clock,
  Search,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { streamChat } from "@/lib/chat/stream-client";
import { Badge } from "@/components/ui/badge";
import { ConversationSidebar } from "@/components/chat/conversation-sidebar";

const MarkdownRenderer = lazy(() =>
  import("@/components/chat/markdown-renderer").then((m) => ({ default: m.MarkdownRenderer }))
);
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
  error?: string | null;
  editorUrl?: string | null;
}

function StreamingStatus({
  phase,
}: {
  phase: "connecting" | "searching" | "thinking" | "streaming" | null;
}) {
  if (!phase || phase === "streaming") return null;

  const labels: Record<string, string> = {
    connecting: "連線中...",
    searching: "正在搜索相關資料...",
    thinking: "正在思考...",
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 h-6 text-sm text-muted-foreground"
    >
      {phase === "connecting" ? (
        <div className="flex space-x-1 items-center">
          <div className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.3s]" />
          <div className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.15s]" />
          <div className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce" />
        </div>
      ) : phase === "searching" ? (
        <Search className="h-3.5 w-3.5 animate-pulse" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      )}
      <span>{labels[phase]}</span>
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
  const [streamingPhase, setStreamingPhase] = useState<
    "connecting" | "searching" | "thinking" | "streaming" | null
  >(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const supabaseRef = useRef(createClient());
  const streamingContentRef = useRef("");
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollTime = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isNew && conversationId) {
      loadMessages();
    }
    setCurrentConvId(isNew ? null : conversationId);
    if (isNew) {
      setMessages([]);
      setN8nResults([]);
    }
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [conversationId]);

  useEffect(() => {
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading, isAtBottom]);

  const handleScroll = useCallback(() => {
    const now = Date.now();
    if (now - lastScrollTime.current < 100) return;
    lastScrollTime.current = now;
    const el = scrollAreaRef.current;
    if (!el) return;
    const viewport = el.querySelector('[data-slot="scroll-area-viewport"]');
    const target = viewport || el;
    const distFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    setIsAtBottom(distFromBottom < 100);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setIsAtBottom(true);
  }, []);

  const loadMessages = useCallback(async () => {
    const { data } = await supabaseRef.current
      .from("chainthings_messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (data) setMessages(data as Message[]);
  }, [conversationId]);

  async function sendMessage(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setLoading(true);
    setStreamingPhase("connecting");
    streamingContentRef.current = "";

    // Cancel any previous pending request
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    const assistantMsgId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: userMessage,
        created_at: new Date().toISOString(),
      },
      {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
      },
    ]);

    try {
      await streamChat(
        "/api/chat",
        {
          message: userMessage,
          conversationId: currentConvId,
          tool: activeTool,
        },
        {
          onStatus: (phase) => setStreamingPhase(phase),
          onSources: (sources) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, sources } : m
              )
            );
          },
          onDelta: (content) => {
            setStreamingPhase("streaming");
            streamingContentRef.current += content;
            if (!updateTimerRef.current) {
              updateTimerRef.current = setTimeout(() => {
                const snap = streamingContentRef.current;
                setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? { ...m, content: snap } : m));
                updateTimerRef.current = null;
              }, 60);
            }
          },
          onN8n: (result) => setN8nResults((prev) => [...prev, result]),
          onDone: (data) => {
            if (updateTimerRef.current) { clearTimeout(updateTimerRef.current); updateTimerRef.current = null; }
            const final1 = streamingContentRef.current;
            if (final1) setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? { ...m, content: final1 } : m));
            if (!currentConvId && data.conversationId) {
              setCurrentConvId(data.conversationId);
              router.replace(`/chat/${data.conversationId}`);
            }
          },
          onError: (errorMsg) => {
            setStreamingPhase(null);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, content: `Error: ${errorMsg}` } : m
              )
            );
          },
        },
        abortControllerRef.current.signal
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const errorMsg =
        err instanceof Error ? err.message : "Error sending message";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, content: `Error: ${errorMsg}` } : m
        )
      );
    } finally {
      setLoading(false);
      setStreamingPhase(null);
    }
  }

  const handleRegenerate = async () => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    streamingContentRef.current = "";

    // Remove last assistant message
    setMessages((prev) => {
      const idx = prev.findLastIndex((m) => m.role === "assistant");
      if (idx === -1) return prev;
      return prev.filter((_, i) => i !== idx);
    });

    const assistantMsgId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
      },
    ]);

    setLoading(true);
    setStreamingPhase("connecting");

    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    try {
      await streamChat(
        "/api/chat",
        {
          message: lastUserMsg.content,
          conversationId: currentConvId,
          tool: activeTool,
        },
        {
          onStatus: (phase) => setStreamingPhase(phase),
          onSources: (sources) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, sources } : m))
            );
          },
          onDelta: (content) => {
            setStreamingPhase("streaming");
            streamingContentRef.current += content;
            if (!updateTimerRef.current) {
              updateTimerRef.current = setTimeout(() => {
                const snap = streamingContentRef.current;
                setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? { ...m, content: snap } : m));
                updateTimerRef.current = null;
              }, 60);
            }
          },
          onN8n: (result) => setN8nResults((prev) => [...prev, result]),
          onDone: (data) => {
            if (updateTimerRef.current) { clearTimeout(updateTimerRef.current); updateTimerRef.current = null; }
            const final2 = streamingContentRef.current;
            if (final2) setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? { ...m, content: final2 } : m));
            if (!currentConvId && data.conversationId) {
              setCurrentConvId(data.conversationId);
            }
          },
          onError: (errorMsg) => {
            setStreamingPhase(null);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: `Error: ${errorMsg}` }
                  : m
              )
            );
          },
        },
        abortControllerRef.current.signal
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const errorMsg =
        err instanceof Error ? err.message : "Error regenerating response";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, content: `Error: ${errorMsg}` } : m
        )
      );
    } finally {
      setLoading(false);
      setStreamingPhase(null);
    }
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
              {n8nResults.map((r, i) => {
                const isError = r.status === "error";
                const isPending = r.status === "pending";
                const badgeClass = isError
                  ? "bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200 border-red-100 dark:border-red-800"
                  : isPending
                  ? "bg-yellow-50 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-200 border-yellow-100 dark:border-yellow-800"
                  : "bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200 border-green-100 dark:border-green-800";
                const iconBgClass = isError
                  ? "bg-red-200 dark:bg-red-800"
                  : isPending
                  ? "bg-yellow-200 dark:bg-yellow-800"
                  : "bg-green-200 dark:bg-green-800";
                const iconColorClass = isError
                  ? "text-red-700 dark:text-red-300"
                  : isPending
                  ? "text-yellow-700 dark:text-yellow-300"
                  : "text-green-700 dark:text-green-300";

                return (
                  <Badge
                    key={i}
                    variant="secondary"
                    className={`pl-1 pr-2 py-0.5 flex items-center gap-1 text-xs ${badgeClass}`}
                    title={isError ? r.error || "建立失敗" : isPending ? "n8n 未連接" : r.name}
                  >
                    <div className={`p-0.5 ${iconBgClass} rounded-full`}>
                      {isError ? (
                        <AlertCircle className={`h-2.5 w-2.5 ${iconColorClass}`} />
                      ) : isPending ? (
                        <Clock className={`h-2.5 w-2.5 ${iconColorClass}`} />
                      ) : (
                        <Zap className={`h-2.5 w-2.5 ${iconColorClass}`} />
                      )}
                    </div>
                    <span className="max-w-[120px] truncate">
                      {isError ? "建立失敗" : isPending ? "n8n 未連接" : r.name}
                    </span>
                    {r.editorUrl && (
                      <a
                        href={r.editorUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-0.5 hover:text-primary"
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </Badge>
                );
              })}
            </div>
          )}
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 mb-2 relative" ref={scrollAreaRef} onScrollCapture={handleScroll}>
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
                      <Suspense fallback={<div className="whitespace-pre-wrap">{msg.content}</div>}>
                        <MarkdownRenderer content={msg.content} />
                      </Suspense>
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

            {loading && streamingPhase && streamingPhase !== "streaming" && (
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-muted border">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="bg-muted rounded-2xl rounded-tl-none px-4 py-2.5 shadow-sm min-w-[80px]">
                  <StreamingStatus phase={streamingPhase} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {!isAtBottom && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10">
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full shadow-lg gap-1"
              onClick={scrollToBottom}
            >
              <ChevronDown className="h-3.5 w-3.5" />
              回到底部
            </Button>
          </div>
        )}

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
