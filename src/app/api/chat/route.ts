import { createClient } from "@/lib/supabase/server";
import { chatCompletion } from "@/lib/openclaw/client";
import { createWorkflow } from "@/lib/n8n/client";
import { NextResponse } from "next/server";

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

  // Get tenant_id
  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Create conversation if not provided
  let convId = conversationId;
  if (!convId) {
    const { data: conv, error: convError } = await supabase
      .from("chainthings_conversations")
      .insert({
        tenant_id: profile.tenant_id,
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

  // Save user message
  await supabase.from("chainthings_messages").insert({
    conversation_id: convId,
    tenant_id: profile.tenant_id,
    role: "user",
    content: message,
  });

  // Get conversation history for context
  const { data: history } = await supabase
    .from("chainthings_messages")
    .select("role, content")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true })
    .limit(50);

  const chatMessages = (history || []).map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  // Prepend system prompt for n8n tool mode
  if (tool === "n8n") {
    chatMessages.unshift({ role: "system", content: N8N_SYSTEM_PROMPT });
  }

  try {
    // Call OpenClaw
    const response = await chatCompletion(chatMessages, user.id);
    const assistantContent =
      response.choices[0]?.message?.content || "No response";

    // Check if response contains an n8n workflow JSON block
    let n8nResult = null;
    const workflowMatch = assistantContent.match(
      /```n8n-workflow\s*([\s\S]*?)```/
    );

    if (workflowMatch) {
      try {
        const workflowData = JSON.parse(workflowMatch[1]);

        // Try to create in n8n
        let n8nWorkflow = null;
        try {
          n8nWorkflow = await createWorkflow(
            workflowData.name || "Untitled",
            workflowData.nodes || [],
            workflowData.connections || {}
          );
        } catch {
          // n8n API might not be configured
        }

        // Save to workflows table
        await supabase.from("chainthings_workflows").insert({
          tenant_id: profile.tenant_id,
          name: workflowData.name || message.substring(0, 100),
          description: workflowData.description,
          prompt: message,
          status: n8nWorkflow ? "active" : "pending",
          n8n_workflow_id: n8nWorkflow?.id || null,
          n8n_data: workflowData,
        });

        n8nResult = {
          name: workflowData.name,
          n8nWorkflowId: n8nWorkflow?.id || null,
          status: n8nWorkflow ? "active" : "pending",
        };
      } catch {
        // JSON parse failed — just show the message as-is
      }
    }

    // Save assistant message
    await supabase.from("chainthings_messages").insert({
      conversation_id: convId,
      tenant_id: profile.tenant_id,
      role: "assistant",
      content: assistantContent,
      metadata: {
        model: "openclaw:main",
        usage: response.usage,
        ...(n8nResult && { n8n: n8nResult }),
      },
    });

    return NextResponse.json({
      conversationId: convId,
      message: assistantContent,
      n8n: n8nResult,
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: errorMessage }, { status: 502 });
  }
}
