import { createClient } from "@/lib/supabase/server";
import { createWorkflow, activateWorkflow } from "@/lib/n8n/client";
import { generateHedyWebhookWorkflow } from "@/lib/n8n/templates/hedy-webhook";
import { NextResponse } from "next/server";

function getWebhookBaseUrl(): string {
  const url =
    process.env.N8N_WEBHOOK_URL ||
    process.env.N8N_API_URL ||
    "http://localhost:5678";
  return url.replace(/\/+$/, "");
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Check if hedy integration exists
  const { data: integration } = await supabase
    .from("chainthings_integrations")
    .select("id, config")
    .eq("tenant_id", profile.tenant_id)
    .eq("service", "hedy.ai")
    .single();

  if (!integration) {
    return NextResponse.json(
      { error: "Please save your Hedy API key first" },
      { status: 400 }
    );
  }

  // Check if workflow already exists
  if (integration.config?.n8n_workflow_id) {
    const n8nUrl = getWebhookBaseUrl();
    return NextResponse.json({
      data: {
        webhookUrl: `${n8nUrl}/webhook/hedy-${profile.tenant_id}`,
        n8nWorkflowId: integration.config.n8n_workflow_id,
        alreadyExists: true,
      },
    });
  }

  // Generate and create workflow
  const supabaseUrl =
    process.env.SUPABASE_URL || "http://localhost:8000";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const template = generateHedyWebhookWorkflow(
    profile.tenant_id,
    supabaseUrl,
    serviceRoleKey
  );

  try {
    const workflow = await createWorkflow(
      template.name,
      template.nodes,
      template.connections
    );

    // Activate the workflow so the webhook is live
    try {
      await activateWorkflow(workflow.id);
    } catch {
      // Activation might fail if n8n requires manual activation — workflow still exists
    }

    // Save workflow ID back to integration config
    await supabase
      .from("chainthings_integrations")
      .update({
        config: {
          ...integration.config,
          n8n_workflow_id: workflow.id,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", integration.id);

    const n8nUrl = getWebhookBaseUrl();

    return NextResponse.json({
      data: {
        webhookUrl: `${n8nUrl}/webhook/hedy-${profile.tenant_id}`,
        n8nWorkflowId: workflow.id,
        active: workflow.active,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to create n8n workflow: ${msg}` },
      { status: 502 }
    );
  }
}
