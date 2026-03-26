import { createClient } from "@/lib/supabase/server";
import { chatCompletion, type ChatCompletionOptions } from "@/lib/ai-gateway";
import { generateEmbedding } from "@/lib/ai-gateway/embeddings";
import { hybridSearch } from "@/lib/rag";
import { createWorkflow, getWorkflowEditorUrl } from "@/lib/n8n/client";
import { validateWorkflowNodes } from "@/lib/n8n/validation";
import { shouldExtractMemory, extractAndSaveMemories } from "@/lib/memory/extractor";
import { NextResponse, after } from "next/server";

const AI_MEMORY_EXTRACTION = process.env.AI_MEMORY_EXTRACTION !== "false";

// Token budget constants
const MAX_HISTORY_FETCH = 20;
const HISTORY_TOKEN_BUDGET = 1200;
const RAG_TOKEN_BUDGET = 900;
const DEADLINE_TOKEN_BUDGET = 150;
const MAX_RAG_RESULTS = 3;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  return text.length <= maxChars ? text : `${text.slice(0, maxChars).trimEnd()}...`;
}

function shouldRunRag(msg: string): boolean {
  const t = msg.trim().toLowerCase();
  if (!t) return false;
  // Skip obvious greetings/acknowledgements (English only — CJK messages always pass)
  if (t.length < 12 && /^(hi|hello|hey|thanks|thank you|ok|okay|yo)\b/.test(t)) return false;
  // Skip very short English-only messages without question marks or numbers
  const hasNonLatin = /[^\x00-\x7F]/.test(t);
  if (!hasNonLatin && t.split(/\s+/).length <= 3 && !/[0-9?]/.test(t)) return false;
  return true;
}

function detectSearchMode(msg: string): "hybrid" | "semantic" | "fulltext" {
  const t = msg.trim().toLowerCase();
  if (/["']|error|id:|exact|where|when|who/.test(t)) return "fulltext";
  if (t.split(/\s+/).length >= 8) return "semantic";
  return "hybrid";
}

function selectHistoryWithinBudget(
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>
) {
  let used = 0;
  const selected: typeof messages = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateTokens(messages[i].content) + 6;
    if (selected.length > 0 && used + cost > HISTORY_TOKEN_BUDGET) break;
    selected.unshift(messages[i]);
    used += cost;
  }
  return selected;
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant. Always respond in Traditional Chinese (繁體中文) unless the user explicitly writes in another language.
Do not include any internal tool calls, XML tags, or system markup in your responses.`;

function stripToolCalls(content: string): string {
  // Remove <tool_call>...</tool_call> blocks that ZeroClaw may include
  return content
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
    .replace(/<tool_result>[\s\S]*?<\/tool_result>/g, "")
    .trim();
}

const N8N_SYSTEM_PROMPT = `You are an n8n workflow assistant. Help the user build n8n workflows through conversation.

When you're ready to generate a workflow, output a JSON code block with this format:

\`\`\`n8n-workflow
{
  "name": "Workflow Name",
  "description": "What it does",
  "nodes": [...valid n8n node objects...],
  "connections": {...valid n8n connection objects...}
}
\`\`\`

Guidelines:
- Ask clarifying questions if the user's request is vague
- Use real n8n node types (n8n-nodes-base.httpRequest, n8n-nodes-base.webhook, n8n-nodes-base.slack, etc.)
- Always include a trigger node (manual, schedule, or webhook)
- Explain what the workflow does before outputting the JSON
- If the user wants changes, output a new complete JSON block
- Keep it conversational and helpful for beginners`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { message, conversationId, tool } = await request.json();

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  // Get tenant profile (needed before integration lookup)
  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const tenantId = profile.tenant_id;

  // Look up tenant's AI gateway config (zeroclaw preferred, openclaw fallback)
  const { data: aiIntegrations } = await supabase
    .from("chainthings_integrations")
    .select("service, config")
    .eq("tenant_id", tenantId)
    .in("service", ["zeroclaw", "openclaw"]);

  const zcIntegration = aiIntegrations?.find((i) => i.service === "zeroclaw");
  const ocIntegration = aiIntegrations?.find((i) => i.service === "openclaw");
  const activeIntegration = zcIntegration || ocIntegration;
  const aiConfig = activeIntegration?.config as Record<string, unknown> | null;
  const aiOptions: ChatCompletionOptions = {
    provider: zcIntegration ? "zeroclaw" : ocIntegration ? "openclaw" : undefined,
    token: (aiConfig?.api_token as string) || undefined,
    tenantId: profile.tenant_id,
  };

  // Create conversation if not provided
  let convId = conversationId;
  if (!convId) {
    const { data: conv, error: convError } = await supabase
      .from("chainthings_conversations")
      .insert({
        tenant_id: tenantId,
        title: message.substring(0, 100),
        model: tool === "n8n" ? "n8n-assistant" : null,
      })
      .select("id")
      .single();

    if (convError) {
      return NextResponse.json({ error: convError.message }, { status: 500 });
    }
    convId = conv.id;
  }

  // Insert first so the current message is visible in history fetch
  await supabase.from("chainthings_messages").insert({
    conversation_id: convId,
    tenant_id: tenantId,
    role: "user",
    content: message,
  });

  const { data: history } = await supabase
    .from("chainthings_messages")
    .select("role, content")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY_FETCH);

  const chatMessages = selectHistoryWithinBudget(
    (history || []).reverse().map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }))
  );

  // Prepend default system prompt (language + behavior)
  chatMessages.unshift({ role: "system", content: DEFAULT_SYSTEM_PROMPT });

  // Prepend tenant-specific system prompt if configured (takes priority over default)
  const tenantSystemPrompt = aiConfig?.system_prompt as
    | string
    | undefined;
  if (tenantSystemPrompt) {
    chatMessages.unshift({ role: "system", content: tenantSystemPrompt });
  }

  // Prepend system prompt for n8n tool mode
  if (tool === "n8n") {
    chatMessages.unshift({ role: "system", content: N8N_SYSTEM_PROMPT });
  }

  // --- Core logic ---

  async function runRag(): Promise<Array<{ id: string; title: string | null; type: string }>> {
    if (tool === "n8n" || !shouldRunRag(message)) return [];
    try {
      const searchMode = detectSearchMode(message);
      const queryEmbedding = await generateEmbedding(message);

      const results = await hybridSearch(queryEmbedding, message, {
        limit: MAX_RAG_RESULTS,
        mode: searchMode,
      });

      if (results.length === 0) return [];

      const sources = results.map((r) => ({
        id: r.documentId,
        title: r.title,
        type: r.sourceType,
      }));

      const contextParts: string[] = ["[Relevant Context]"];
      let ragBudgetUsed = estimateTokens(contextParts[0]);

      for (const result of results) {
        const label = result.sourceType === "item" ? "Meeting Note" :
          result.sourceType === "memory" ? "Memory" : "Conversation";
        const chunk = `[${label}: ${result.title || "Untitled"}]\n${truncateToTokens(result.content, 220)}`;
        const chunkCost = estimateTokens(chunk);
        if (ragBudgetUsed + chunkCost > RAG_TOKEN_BUDGET) break;
        contextParts.push(chunk);
        ragBudgetUsed += chunkCost;
      }

      // Fetch upcoming deadlines (keep this — clear product value)
      const threeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const { data: deadlines } = await supabase
        .from("chainthings_memory_entries")
        .select("content, due_date")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .eq("category", "task")
        .not("due_date", "is", null)
        .lte("due_date", threeDays)
        .order("due_date", { ascending: true })
        .limit(5);
      if (deadlines?.length) {
        const now = Date.now();
        const deadlineLines = ["[Upcoming Deadlines]"];
        let budget = 0;
        for (const d of deadlines) {
          const daysLeft = Math.ceil((new Date(d.due_date).getTime() - now) / (24 * 60 * 60 * 1000));
          const label = daysLeft <= 0 ? "overdue" : daysLeft === 1 ? "due tomorrow" : `due in ${daysLeft} days`;
          const line = `- ${d.content} (${label})`;
          budget += estimateTokens(line);
          if (budget > DEADLINE_TOKEN_BUDGET) break;
          deadlineLines.push(line);
        }
        if (deadlineLines.length > 1) contextParts.push(deadlineLines.join("\n"));
      }

      if (contextParts.length > 1) {
        chatMessages.unshift({
          role: "system",
          content: contextParts.join("\n") +
            "\n\nUse the above context to answer the user's question. Cite sources when referencing specific meeting notes or tasks.",
        });
      }

      return sources;
    } catch {
      return [];
    }
  }

  async function processN8n(assistantContent: string) {
    const workflowMatch = assistantContent.match(
      /```n8n-workflow\s*([\s\S]*?)```/
    );
    if (!workflowMatch) return null;

    try {
      const workflowData = JSON.parse(workflowMatch[1]);
      const validation = validateWorkflowNodes(workflowData.nodes || []);
      if (!validation.valid) {
        return {
          name: workflowData.name,
          error: `Disallowed node types: ${validation.disallowed.join(", ")}`,
          status: "rejected",
        };
      }

      let n8nWorkflow = null;
      let n8nErrorMsg: string | null = null;
      try {
        n8nWorkflow = await createWorkflow(
          workflowData.name || "Untitled",
          workflowData.nodes || [],
          workflowData.connections || {},
          ["chainthings", `tenant:${tenantId}`]
        );
      } catch (n8nErr) {
        n8nErrorMsg = n8nErr instanceof Error ? n8nErr.message : "n8n connection failed";
      }

      const wfStatus = n8nWorkflow ? "active" : n8nErrorMsg ? "error" : "pending";

      await supabase.from("chainthings_workflows").insert({
        tenant_id: tenantId,
        name: workflowData.name || message.substring(0, 100),
        description: workflowData.description,
        prompt: message,
        status: wfStatus,
        n8n_workflow_id: n8nWorkflow?.id || null,
        n8n_data: workflowData,
        error_message: n8nErrorMsg,
      });

      return {
        name: workflowData.name,
        n8nWorkflowId: n8nWorkflow?.id || null,
        status: wfStatus,
        error: n8nErrorMsg,
        editorUrl: n8nWorkflow ? getWorkflowEditorUrl(n8nWorkflow.id) : null,
      };
    } catch {
      return null;
    }
  }

  try {
    const ragSources = await runRag();

    const response = await chatCompletion(chatMessages, user.id, aiOptions);
    const rawContent = response.choices[0]?.message?.content || "No response";
    const assistantContent = stripToolCalls(rawContent);

    const n8nResult = await processN8n(assistantContent);

    await supabase.from("chainthings_messages").insert({
      conversation_id: convId,
      tenant_id: tenantId,
      role: "assistant",
      content: assistantContent,
      metadata: {
        usage: response.usage,
        ...(n8nResult && { n8n: n8nResult }),
      },
    });

    // Memory extraction (deferred — doesn't block JSON response)
    if (AI_MEMORY_EXTRACTION && shouldExtractMemory(message, tool)) {
      after(async () => {
        try { await extractAndSaveMemories(message, assistantContent, tenantId, aiOptions); } catch { /* non-fatal */ }
      });
    }

    return NextResponse.json({
      conversationId: convId,
      message: assistantContent,
      n8n: n8nResult,
      sources: ragSources.length > 0 ? ragSources : undefined,
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: errorMessage }, { status: 502 });
  }
}
