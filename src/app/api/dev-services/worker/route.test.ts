import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "./route";
import { processAllPending, processEvent } from "@/lib/dev-services/event-worker";
import { createJsonRequest, createGetRequest, getJsonResponse } from "@/__tests__/helpers";

vi.mock("@/lib/dev-services/event-worker", () => ({
  processEvent: vi.fn(),
  processAllPending: vi.fn(),
}));

const mockProcessEvent = vi.mocked(processEvent);
const mockProcessAllPending = vi.mocked(processAllPending);

function authorizedRequest(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/dev-services/worker", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-cron-secret",
    },
    body: JSON.stringify(body),
  });
}

describe("/api/dev-services/worker", () => {
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.CRON_SECRET = "test-cron-secret";
    mockProcessEvent.mockResolvedValue(undefined);
    mockProcessAllPending.mockResolvedValue(3);
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret;
    vi.restoreAllMocks();
  });

  it("should return 503 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const request = createJsonRequest("http://localhost/api/dev-services/worker", {});

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(503);
    expect(body.error).toBe("CRON_SECRET not configured");
  });

  it("should return 401 for missing or wrong authorization headers", async () => {
    const request = new Request("http://localhost/api/dev-services/worker", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
    });

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should process a single event when eventId is provided", async () => {
    const response = await POST(authorizedRequest({ eventId: "event-1" }));
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: 1 });
    expect(mockProcessEvent).toHaveBeenCalledWith("event-1");
    expect(mockProcessAllPending).not.toHaveBeenCalled();
  });

  it("should process all pending events when no eventId is provided", async () => {
    mockProcessAllPending.mockResolvedValue(7);

    const response = await POST(authorizedRequest());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: 7 });
    expect(mockProcessAllPending).toHaveBeenCalledOnce();
    expect(mockProcessEvent).not.toHaveBeenCalled();
  });

  it("should let GET delegate to the same worker behavior as POST", async () => {
    const request = createGetRequest("http://localhost/api/dev-services/worker");
    request.headers.set("Authorization", "Bearer test-cron-secret");

    const response = await GET(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: 3 });
    expect(mockProcessAllPending).toHaveBeenCalledOnce();
  });

  it("should return 500 with sanitized worker errors when processEvent throws", async () => {
    mockProcessEvent.mockRejectedValue(new Error("event failed"));

    const response = await POST(authorizedRequest({ eventId: "event-1" }));
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("event failed");
  });
});
