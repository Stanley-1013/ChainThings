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
  ChevronDown,
  Code2,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

function ProgressStatus({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startTime), 1000);
    return () => clearInterval(id);
  }, [startTime]);

  const label =
    elapsed < 3000 ? "正在搜索相關資料..." :
    elapsed < 8000 ? "找到相關資料，正在生成回覆..." :
    "回覆較長，請稍候...";

  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 h-6 text-sm text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span>{label}</span>
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
  type DevResult = { projectId?: string; service?: string; action?: string; workflow?: string; params: unknown; requiresApproval: boolean; approvalToken?: string };
  const [devResults, setDevResults] = useState<DevResult[]>([]);
  const [pendingAction, setPendingAction] = useState<{ index: number; result: DevResult } | null>(null);
  const [devProjects, setDevProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [currentConvId, setCurrentConvId] = useState<string | null>(
    isNew ? null : conversationId
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [loadingStartTime, setLoadingStartTime] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const supabaseRef = useRef(createClient());
  const abortRef = useRef<AbortController | null>(null);
  const lastScrollTime = useRef(0);

  useEffect(() => {
    abortRef.current?.abort();
    setLoading(false);
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
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading, isAtBottom]);

  useEffect(() => {
    if (activeTool !== "dev" || devProjects.length > 0) return;
    void fetch("/api/dev-services/projects")
      .then((r) => r.json() as Promise<{ data?: Array<{ id: string; name: string }> }>)
      .then((j) => {
        const list = j.data ?? [];
        setDevProjects(list.map((p) => ({ id: p.id, name: p.name })));
        if (list[0] && !activeProjectId) setActiveProjectId(list[0].id);
      })
      .catch(() => {});
  }, [activeTool, devProjects.length, activeProjectId]);

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
    setLoadingStartTime(Date.now());
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: userMessage, created_at: new Date().toISOString() },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, conversationId: currentConvId, tool: activeTool, projectId: activeProjectId ?? undefined }),
        signal,
      });
      if (signal.aborted) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send message");

      if (!currentConvId && data.conversationId) {
        setCurrentConvId(data.conversationId);
        router.replace(`/chat/${data.conversationId}`);
      }
      if (data.n8n) setN8nResults((prev) => [...prev, data.n8n]);
      if (data.devService) setDevResults((prev) => [...prev, data.devService]);

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: data.message, created_at: new Date().toISOString(), sources: data.sources },
      ]);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const errorMsg = err instanceof Error ? err.message : "Error sending message";
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: `Error: ${errorMsg}`, created_at: new Date().toISOString() },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const handleRegenerate = async () => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;

    setMessages((prev) => {
      const idx = prev.findLastIndex((m) => m.role === "assistant");
      if (idx === -1) return prev;
      return prev.filter((_, i) => i !== idx);
    });
    setLoading(true);
    setLoadingStartTime(Date.now());
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: lastUserMsg.content, conversationId: currentConvId, tool: activeTool, projectId: activeProjectId ?? undefined }),
        signal,
      });
      if (signal.aborted) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to regenerate");

      if (data.n8n) setN8nResults((prev) => [...prev, data.n8n]);
      if (data.devService) setDevResults((prev) => [...prev, data.devService]);

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: data.message, created_at: new Date().toISOString(), sources: data.sources },
      ]);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const errorMsg = err instanceof Error ? err.message : "Error regenerating response";
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: `Error: ${errorMsg}`, created_at: new Date().toISOString() },
      ]);
    } finally {
      setLoading(false);
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

      {/* Dev action confirm dialog */}
      <Dialog open={pendingAction != null} onOpenChange={(open) => { if (!open) setPendingAction(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
              Execute action?
            </DialogTitle>
            <DialogDescription>
              Review the action details below before confirming execution.
            </DialogDescription>
          </DialogHeader>
          {pendingAction && (
            <div className="space-y-3 py-1">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <span className="text-muted-foreground">Action</span>
                <span className="font-medium">{pendingAction.result.workflow ?? pendingAction.result.action ?? "dev action"}</span>
                <span className="text-muted-foreground">Service</span>
                <span className="font-medium">{pendingAction.result.service ?? "github"}</span>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Params</p>
                <pre className="rounded-lg bg-muted px-3 py-2 text-xs overflow-auto max-h-40 whitespace-pre-wrap break-all">
                  {JSON.stringify(pendingAction.result.params, null, 2)}
                </pre>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!pendingAction) return;
                const { index: i, result: r } = pendingAction;
                const pid = r.projectId ?? activeProjectId;
                if (!pid) { setPendingAction(null); return; }
                const res = await fetch("/api/dev-services/actions", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    projectId: pid,
                    service: r.service ?? "github",
                    action: r.workflow ? "execute_workflow" : r.action,
                    params: r.workflow ? { workflow: r.workflow, params: r.params } : r.params,
                    approvalToken: r.approvalToken,
                  }),
                });
                if (res.ok) {
                  setDevResults((prev) => prev.map((d, j) => j === i ? { ...d, requiresApproval: false } : d));
                }
                setPendingAction(null);
              }}
            >
              Confirm Execute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          {activeTool === "dev" && (
            <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-800 rounded-lg text-sm text-blue-800 dark:text-blue-200">
              <Code2 className="h-3.5 w-3.5 text-blue-500" />
              <span className="font-semibold text-xs">dev mode</span>
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

          {devResults.length > 0 && (
            <div className="flex flex-wrap gap-1.5 ml-auto">
              {devResults.map((r, i) => (
                <Badge
                  key={i}
                  variant="secondary"
                  className="pl-1 pr-2 py-0.5 flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-950 text-blue-800 dark:text-blue-200 border-blue-100 dark:border-blue-800"
                >
                  <div className="p-0.5 bg-blue-200 dark:bg-blue-800 rounded-full">
                    <Code2 className="h-2.5 w-2.5 text-blue-700 dark:text-blue-300" />
                  </div>
                  <span className="max-w-[150px] truncate">
                    {r.workflow ?? r.action ?? "dev action"}
                  </span>
                  {r.requiresApproval && (
                    <button
                      className="ml-1 text-xs bg-blue-600 text-white rounded px-2 py-1 hover:bg-blue-700"
                      onClick={() => setPendingAction({ index: i, result: r })}
                    >
                      Execute
                    </button>
                  )}
                  {!r.requiresApproval && (
                    <span className="text-[9px] text-green-600">✓</span>
                  )}
                </Badge>
              ))}
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

            {loading && (
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-muted border">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="bg-muted rounded-2xl rounded-tl-none px-4 py-2.5 shadow-sm min-w-[80px]">
                  <ProgressStatus startTime={loadingStartTime} />
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
              <Button
                variant={activeTool === "dev" ? "default" : "secondary"}
                size="sm"
                onClick={() =>
                  setActiveTool(activeTool === "dev" ? null : "dev")
                }
                className={cn(
                  "h-7 text-[10px] uppercase tracking-wider font-bold",
                  activeTool === "dev" &&
                    "bg-blue-500 hover:bg-blue-600 text-white"
                )}
              >
                <Code2
                  className={cn(
                    "h-3 w-3 mr-1",
                    activeTool === "dev" && "fill-current"
                  )}
                />
                dev tool
              </Button>
              {activeTool === "dev" && devProjects.length > 0 && (
                <select
                  value={activeProjectId ?? ""}
                  onChange={(e) => setActiveProjectId(e.target.value || null)}
                  className="h-7 rounded-md border border-input bg-background px-2 text-[10px] uppercase tracking-wider font-bold"
                  title="Dev project context"
                >
                  {devProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <form onSubmit={sendMessage} className="relative">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  activeTool === "n8n"
                    ? "Describe your workflow..."
                    : activeTool === "dev"
                      ? "Review PR #42, create feature ticket, sprint summary..."
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
