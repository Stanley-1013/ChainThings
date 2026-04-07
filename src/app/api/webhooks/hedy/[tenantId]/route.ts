import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractItemMetadata } from "@/lib/items/extractor";
import { NextResponse, after } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

async function getTenantWebhookSecret(tenantId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("chainthings_integrations")
    .select("webhook_secret")
    .eq("tenant_id", tenantId)
    .eq("service", "hedy.ai")
    .single();
  return data?.webhook_secret ?? null;
}

function verifySignature(
  tenantId: string,
  timestamp: string,
  signature: string,
  body: string,
  secret: string
): boolean {
  const payload = `${tenantId}:${timestamp}:${body}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;

  // Per-tenant secret authentication (no global fallback)
  const tenantSecret = await getTenantWebhookSecret(tenantId);
  if (!tenantSecret) {
    return NextResponse.json(
      { error: "Webhook not configured for this tenant" },
      { status: 401 }
    );
  }

  const sharedSecret = request.headers.get("x-chainthings-secret");
  const timestamp = request.headers.get("x-chainthings-timestamp");
  const signature = request.headers.get("x-chainthings-signature");

  const rawBody = await request.text();

  if (sharedSecret) {
    const secretMatch = sharedSecret.length === tenantSecret.length &&
      timingSafeEqual(Buffer.from(sharedSecret), Buffer.from(tenantSecret));
    if (!secretMatch) {
      return NextResponse.json(
        { error: "Invalid secret" },
        { status: 401 }
      );
    }
  } else if (timestamp && signature) {
    const requestTime = parseInt(timestamp, 10);
    if (
      isNaN(requestTime) ||
      Math.abs(Date.now() - requestTime) > TIMESTAMP_TOLERANCE_MS
    ) {
      return NextResponse.json(
        { error: "Request expired" },
        { status: 401 }
      );
    }
    if (!verifySignature(tenantId, timestamp, signature, rawBody, tenantSecret)) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }
  } else {
    return NextResponse.json(
      { error: "Missing authentication headers" },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Verify tenant exists
  const { data: profile } = await supabaseAdmin
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .single();

  if (!profile) {
    return NextResponse.json(
      { error: "Invalid tenant" },
      { status: 400 }
    );
  }

  const { type, title, content, external_id, metadata } = body;

  const { data, error } = await supabaseAdmin
    .from("chainthings_items")
    .insert({
      tenant_id: tenantId,
      type: typeof type === "string" ? type : "meeting_note",
      title: typeof title === "string" ? title.slice(0, 500) : "Untitled",
      content: typeof content === "string" ? content : "",
      external_id:
        typeof external_id === "string" ? external_id.slice(0, 255) : null,
      metadata: metadata && typeof metadata === "object" ? metadata : {},
    })
    .select("id")
    .single();

  if (error) {
    console.error("Webhook insert failed:", error.message);
    return NextResponse.json(
      { error: "Failed to save item" },
      { status: 500 }
    );
  }

  // Auto-extract metadata (summary, keyPoints, actionItems) in background
  after(async () => {
    try {
      // Look up tenant AI config for extraction
      const { data: aiIntegrations } = await supabaseAdmin
        .from("chainthings_integrations")
        .select("service, config")
        .eq("tenant_id", tenantId)
        .in("service", ["zeroclaw", "openclaw"]);

      const zcIntegration = aiIntegrations?.find((i) => i.service === "zeroclaw");
      const ocIntegration = aiIntegrations?.find((i) => i.service === "openclaw");
      const aiConfig = (zcIntegration || ocIntegration)?.config as Record<string, unknown> | null;

      await extractItemMetadata(data.id, tenantId, {
        provider: zcIntegration ? "zeroclaw" : ocIntegration ? "openclaw" : undefined,
        token: (aiConfig?.api_token as string) || undefined,
        tenantId,
      });
    } catch {
      // Extraction failure is non-fatal — item is already saved
    }
  });

  return NextResponse.json({ success: true, id: data.id });
}
