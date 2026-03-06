"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";

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
            <div
              key={i}
              className="my-2 rounded border border-green-300 bg-green-50 px-3 py-2 text-xs"
            >
              <span className="font-semibold text-green-700">
                Workflow JSON generated
              </span>
            </div>
          );
        }
        return part ? <span key={i}>{part}</span> : null;
      })}
    </>
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
    if (!isNew) {
      loadMessages();
    }
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadMessages() {
    const { data } = await supabase
      .from("chainthings_messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (data) setMessages(data);
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
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

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      {/* Tool indicator */}
      {activeTool === "n8n" && (
        <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border-b border-orange-200 text-sm">
          <span className="font-medium text-orange-700">n8n mode</span>
          <span className="text-orange-500">
            — Describe the workflow you want, AI will help you build it
          </span>
        </div>
      )}

      {/* n8n workflow results */}
      {n8nResults.length > 0 && (
        <div className="px-3 py-2 bg-green-50 border-b border-green-200 space-y-1">
          {n8nResults.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-green-700 font-medium">{r.name}</span>
              <span
                className={`text-xs ${r.status === "active" ? "text-green-600" : "text-yellow-600"}`}
              >
                ({r.status})
              </span>
              {r.n8nWorkflowId && (
                <a
                  href={`http://localhost:5678/workflow/${r.n8nWorkflowId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline"
                >
                  Open in n8n
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4 pt-4 px-2">
        {messages.length === 0 && (
          <p className="text-gray-400 text-center mt-20">
            {activeTool === "n8n"
              ? 'Describe the workflow you want. e.g., "A webhook that receives data and saves it to a Google Sheet"'
              : "Send a message to start the conversation."}
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[70%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-900"
              }`}
            >
              {msg.role === "assistant" ? (
                <MessageContent content={msg.content} />
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-4 py-2 text-sm text-gray-500">
              {activeTool === "n8n" ? "Building workflow..." : "Thinking..."}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area with tool buttons */}
      <div className="border-t pt-3 space-y-2">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() =>
              setActiveTool(activeTool === "n8n" ? null : "n8n")
            }
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              activeTool === "n8n"
                ? "bg-orange-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            n8n
          </button>
        </div>
        <form onSubmit={sendMessage} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              activeTool === "n8n"
                ? "Describe your workflow..."
                : "Type a message..."
            }
            disabled={loading}
            className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
