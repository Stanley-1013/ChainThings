import { createClient } from "@/lib/supabase/server";
import { chatCompletion } from "@/lib/openclaw/client";
import { createWorkflow } from "@/lib/n8n/client";
import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are an n8n workflow generator. When asked to create a workflow, respond ONLY with valid JSON in this format:
{
  "name": "workflow name",
  "description": "brief description",
  "nodes": [...n8n node objects...],
  "connections": {...n8n connection objects...}
}
Use real n8n node types (e.g., n8n-nodes-base.httpRequest, n8n-nodes-base.webhook, etc.).
Always include a Start/Manual Trigger node. Do not include any explanation outside the JSON.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prompt } = await request.json();

  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Create workflow record
  const { data: workflowRecord, error: insertError } = await supabase
    .from("chainthings_workflows")
    .insert({
      tenant_id: profile.tenant_id,
      name: prompt.substring(0, 100),
      prompt,
      status: "generating",
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  try {
    // Ask OpenClaw to generate workflow JSON
    const response = await chatCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      user.id
    );

    const content = response.choices[0]?.message?.content || "";

    // Try to parse the JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("AI did not return valid JSON");
    }

    const workflowData = JSON.parse(jsonMatch[0]);

    // Create workflow in n8n
    let n8nWorkflow = null;
    try {
      n8nWorkflow = await createWorkflow(
        workflowData.name || prompt.substring(0, 50),
        workflowData.nodes || [],
        workflowData.connections || {}
      );
    } catch {
      // n8n API might not be configured yet — save the data anyway
    }

    // Update record
    await supabase
      .from("chainthings_workflows")
      .update({
        name: workflowData.name || prompt.substring(0, 100),
        description: workflowData.description,
        status: n8nWorkflow ? "active" : "pending",
        n8n_workflow_id: n8nWorkflow?.id || null,
        n8n_data: workflowData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", workflowRecord.id);

    return NextResponse.json({
      workflow: {
        ...workflowRecord,
        name: workflowData.name,
        description: workflowData.description,
        status: n8nWorkflow ? "active" : "pending",
        n8n_workflow_id: n8nWorkflow?.id,
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";

    await supabase
      .from("chainthings_workflows")
      .update({ status: "error", updated_at: new Date().toISOString() })
      .eq("id", workflowRecord.id);

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
