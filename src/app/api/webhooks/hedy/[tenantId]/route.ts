import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { createHmac } from "crypto";

const WEBHOOK_SECRET = () => process.env.CHAINTHINGS_WEBHOOK_SECRET!;
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

function verifySignature(
  tenantId: string,
  timestamp: string,
  signature: string,
  body: string
): boolean {
  const secret = WEBHOOK_SECRET();
  const payload = `${tenantId}:${timestamp}:${body}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  return expected === signature;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;

  // Support two auth modes:
  // 1. Shared secret (X-ChainThings-Secret) — used by n8n workflows
  // 2. HMAC signature (X-ChainThings-Timestamp + X-ChainThings-Signature) — legacy
  const sharedSecret = request.headers.get("x-chainthings-secret");
  const timestamp = request.headers.get("x-chainthings-timestamp");
  const signature = request.headers.get("x-chainthings-signature");

  const rawBody = await request.text();

  if (sharedSecret) {
    // Shared secret auth
    if (sharedSecret !== WEBHOOK_SECRET()) {
      return NextResponse.json(
        { error: "Invalid secret" },
        { status: 401 }
      );
    }
  } else if (timestamp && signature) {
    // HMAC auth with replay protection
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
    if (!verifySignature(tenantId, timestamp, signature, rawBody)) {
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

  return NextResponse.json({ success: true, id: data.id });
}
