import { supabaseAdmin } from "@/lib/supabase/admin";
import { getWebhookVerifier } from "@/lib/dev-services/webhook-registry";
import { normalizeEvent } from "@/lib/dev-services/event-normalizer";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ service: string; integrationId: string }> },
) {
  const { service, integrationId } = await params;

  // 1. Find integration by id + verify service matches
  const { data: integration } = await supabaseAdmin
    .from("chainthings_integrations")
    .select("id, tenant_id, webhook_secret, dev_project_id")
    .eq("id", integrationId)
    .eq("service", service)
    .eq("status", "active")
    .maybeSingle();

  if (!integration?.webhook_secret) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 });
  }

  const tenantId = integration.tenant_id;

  // 2. Verify signature
  const verifier = getWebhookVerifier(service);
  if (!verifier) {
    return NextResponse.json({ error: `Unsupported service: ${service}` }, { status: 400 });
  }

  const rawBody = await request.text();
  if (!verifier.verify(rawBody, request.headers, integration.webhook_secret)) {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  // 3. Idempotency check
  const deliveryId = verifier.getDeliveryId(request.headers);
  if (deliveryId) {
    const { data: existing } = await supabaseAdmin
      .from("chainthings_webhook_events")
      .select("id")
      .eq("integration_id", integration.id)
      .eq("delivery_id", deliveryId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ success: true, duplicate: true }, { status: 200 });
    }
  }

  // 4. Parse + normalize
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
  const eventType = verifier.getEventType(request.headers, payload);
  const normalized = normalizeEvent(service, eventType, payload);

  // 5. Write to DB (received status)
  const { data: event, error } = await supabaseAdmin
    .from("chainthings_webhook_events")
    .insert({
      tenant_id: tenantId,
      integration_id: integration.id,
      service,
      event_type: eventType,
      normalized_event: normalized?.eventName ?? null,
      delivery_id: deliveryId,
      payload,
      status: "received",
      dev_project_id: integration.dev_project_id ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // Unique constraint violation = duplicate delivery_id (race condition)
    if (error.code === "23505") {
      return NextResponse.json({ success: true, duplicate: true }, { status: 200 });
    }
    return NextResponse.json({ error: "Failed to store event" }, { status: 500 });
  }

  // 6. Fire-and-forget: trigger worker (don't await)
  const workerUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001"}/api/dev-services/worker`;
  const cronSecret = process.env.CRON_SECRET ?? "";
  fetch(workerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cronSecret}` },
    body: JSON.stringify({ eventId: event.id }),
  }).catch(() => {
    /* fire-and-forget, worker cron will pick it up */
  });

  // 7. Immediate 202
  return NextResponse.json({ success: true, eventId: event.id }, { status: 202 });
}
