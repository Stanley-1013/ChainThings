import { createClient } from "@/lib/supabase/server";
import { type ChatCompletionOptions } from "@/lib/ai-gateway";
import { extractItemMetadata } from "@/lib/items/extractor";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { itemId } = await request.json();
  if (!itemId) {
    return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("chainthings_profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile?.tenant_id) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Look up tenant AI config
  const { data: aiIntegrations } = await supabase
    .from("chainthings_integrations")
    .select("service, config")
    .eq("tenant_id", profile.tenant_id)
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

  try {
    const result = await extractItemMetadata(itemId, profile.tenant_id, aiOptions);
    if (!result) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
