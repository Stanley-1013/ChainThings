import { createClient } from "@/lib/supabase/server";
import { createDevServiceClient } from "@/lib/dev-services/factory";
import { getAction, validateActionInput } from "@/lib/dev-services/action-registry";
import { consumeApprovalToken } from "@/lib/dev-services/approval";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const body = (await request.json()) as {
    projectId: string;
    service: string;
    action: string;
    params?: Record<string, unknown>;
    approvalToken?: string;
  };

  const { projectId, service, action: actionName, params = {}, approvalToken } = body;
  if (!projectId || !service || !actionName) {
    return NextResponse.json({ error: "projectId, service and action required" }, { status: 400 });
  }

  // Verify the project belongs to the user's tenant
  const { data: devProject } = await supabase
    .from("chainthings_dev_projects")
    .select("id")
    .eq("id", projectId)
    .eq("tenant_id", profile.tenant_id)
    .single();
  if (!devProject) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Lookup action definition
  const actionDef = getAction(actionName);
  if (!actionDef) {
    return NextResponse.json({ error: `Unknown action: ${actionName}` }, { status: 400 });
  }

  // Validate input schema
  const validation = validateActionInput(actionName, params);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // Check approval token for destructive actions
  if (actionDef.requiresApproval) {
    if (!approvalToken) {
      return NextResponse.json({ error: "This action requires approval. Provide approvalToken." }, { status: 403 });
    }
    const approved = await consumeApprovalToken(approvalToken, profile.tenant_id, actionName, validation.data);
    if (!approved) {
      return NextResponse.json({ error: "Invalid, expired, consumed, or mismatched approval token" }, { status: 403 });
    }
  }

  // Workflows orchestrate multiple services internally — skip the single-service
  // client gate and capability check for execute_workflow.
  if (actionName === "execute_workflow") {
    try {
      const result = await actionDef.handler(
        null as unknown as import("@/lib/dev-services/types").DevServiceClient,
        profile.tenant_id,
        projectId,
        validation.data,
      );
      return NextResponse.json({ data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Workflow failed";
      console.error(`Workflow execution failed:`, err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Create client + check capability
  try {
    const client = await createDevServiceClient(profile.tenant_id, projectId, service);
    if (!client.capabilities.includes(actionDef.requiredCapability)) {
      return NextResponse.json(
        { error: `${service} does not support ${actionDef.requiredCapability}` },
        { status: 400 },
      );
    }

    const result = await actionDef.handler(client, profile.tenant_id, projectId, validation.data);
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error(`Action ${actionName} on ${service} failed:`, err);
    return NextResponse.json({ error: "Action failed. Check server logs." }, { status: 500 });
  }
}
