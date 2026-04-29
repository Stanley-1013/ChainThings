import { processEvent, processAllPending } from "@/lib/dev-services/event-worker";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  // Auth: CRON_SECRET required
  const auth = request.headers.get("authorization")?.replace("Bearer ", "");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (auth !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const eventId = (body as Record<string, unknown>).eventId as string | undefined;

    if (eventId) {
      // Process specific event (triggered by webhook fire-and-forget)
      await processEvent(eventId);
      return NextResponse.json({ processed: 1 });
    }

    // Process all pending (triggered by cron)
    const count = await processAllPending();
    return NextResponse.json({ processed: count });
  } catch (err) {
    console.error("Event worker error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Worker failed" },
      { status: 500 },
    );
  }
}
