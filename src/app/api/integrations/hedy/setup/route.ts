import { createClient } from "@/lib/supabase/server";
import {
  createWorkflow,
  activateWorkflow,
  getWorkflow,
  deleteWorkflow,
  listWorkflows,
} from "@/lib/n8n/client";
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

  const n8nUrl = getWebhookBaseUrl();

  // Check if workflow already exists — verify it's alive in n8n
  if (integration.config?.n8n_workflow_id) {
    const workflowId = integration.config.n8n_workflow_id as string;

    // Step 1: Check if workflow exists in n8n
    let existing;
    try {
      existing = await getWorkflow(workflowId);
    } catch {
      // Workflow gone from n8n — clear stale ID and recreate below
      await supabase
        .from("chainthings_integrations")
        .update({
          config: { ...integration.config, n8n_workflow_id: null },
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration.id);
      existing = null;
    }

    if (existing) {
      if (existing.active) {
        return NextResponse.json({
          data: {
            webhookUrl: `${n8nUrl}/webhook/hedy-${profile.tenant_id}`,
            n8nWorkflowId: workflowId,
            active: true,
            alreadyExists: true,
          },
        });
      }

      // Step 2: Workflow exists but inactive — try to reactivate (separate error path)
      try {
        await activateWorkflow(workflowId);
        return NextResponse.json({
          data: {
            webhookUrl: `${n8nUrl}/webhook/hedy-${profile.tenant_id}`,
            n8nWorkflowId: workflowId,
            active: true,
            reactivated: true,
          },
        });
      } catch (activationErr) {
        const msg =
          activationErr instanceof Error
            ? activationErr.message
            : "Unknown error";
        return NextResponse.json(
          {
            error: `Workflow exists but reactivation failed: ${msg}`,
          },
          { status: 502 }
        );
      }
    }
  }

  // Generate and create workflow — POST to our own API instead of direct Supabase
  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  const webhookSecret = process.env.CHAINTHINGS_WEBHOOK_SECRET!;

  const template = generateHedyWebhookWorkflow(
    profile.tenant_id,
    appBaseUrl,
    webhookSecret
  );

  // Clean up any orphaned workflows with the same webhook path to avoid conflicts
  try {
    const { data: allWorkflows } = await listWorkflows();
    const orphaned = allWorkflows.filter(
      (wf) =>
        wf.name.includes(profile.tenant_id.slice(0, 8)) &&
        wf.name.includes("Hedy")
    );
    for (const wf of orphaned) {
      try {
        await deleteWorkflow(wf.id);
      } catch {
        // best effort
      }
    }
  } catch {
    // listWorkflows failed — proceed anyway
  }

  try {
    const workflow = await createWorkflow(
      template.name,
      template.nodes,
      template.connections,
      ["chainthings", `tenant:${profile.tenant_id}`]
    );

    // Activate the workflow so the webhook is live
    try {
      await activateWorkflow(workflow.id);
    } catch (activationErr) {
      // Workflow exists but won't receive traffic — clean up and report
      try {
        await deleteWorkflow(workflow.id);
      } catch {
        // best effort cleanup
      }
      const msg =
        activationErr instanceof Error
          ? activationErr.message
          : "Unknown error";
      return NextResponse.json(
        {
          error: `Workflow created but activation failed: ${msg}. The webhook will not work until activation succeeds.`,
        },
        { status: 502 }
      );
    }

    // Only save workflow ID after successful activation
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

    return NextResponse.json({
      data: {
        webhookUrl: `${n8nUrl}/webhook/hedy-${profile.tenant_id}`,
        n8nWorkflowId: workflow.id,
        active: true,
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
