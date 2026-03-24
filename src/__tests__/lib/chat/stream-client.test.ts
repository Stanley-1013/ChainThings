import { describe, it, expect, vi } from "vitest";
import { streamChat, type StreamCallbacks } from "@/lib/chat/stream-client";

function mockSSEResponse(events: Array<{ event: string; data: unknown }>) {
  const lines = events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join("");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("streamChat", () => {
  it("should parse status events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockSSEResponse([
        { event: "status", data: { phase: "searching" } },
        { event: "status", data: { phase: "thinking" } },
        { event: "delta", data: { content: "Hello" } },
        { event: "done", data: { conversationId: "conv-1" } },
      ])
    );

    const callbacks: StreamCallbacks = {
      onStatus: vi.fn(),
      onDelta: vi.fn(),
      onDone: vi.fn(),
    };

    await streamChat("/api/chat", { message: "hi" }, callbacks);

    expect(callbacks.onStatus).toHaveBeenCalledWith("searching");
    expect(callbacks.onStatus).toHaveBeenCalledWith("thinking");
    expect(callbacks.onDelta).toHaveBeenCalledWith("Hello");
    expect(callbacks.onDone).toHaveBeenCalledWith({ conversationId: "conv-1" });
  });

  it("should handle error responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    );

    const callbacks: StreamCallbacks = { onError: vi.fn() };
    await streamChat("/api/chat", { message: "hi" }, callbacks);

    expect(callbacks.onError).toHaveBeenCalledWith("Unauthorized");
  });

  it("should handle SSE error events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockSSEResponse([
        { event: "error", data: { message: "AI timeout" } },
      ])
    );

    const callbacks: StreamCallbacks = { onError: vi.fn() };
    await streamChat("/api/chat", { message: "hi" }, callbacks);

    expect(callbacks.onError).toHaveBeenCalledWith("AI timeout");
  });

  it("should handle n8n and sources events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockSSEResponse([
        { event: "sources", data: [{ id: "doc-1", title: "Meeting", type: "item" }] },
        { event: "n8n", data: { name: "Test WF", n8nWorkflowId: "123", status: "active" } },
        { event: "done", data: { conversationId: "conv-1" } },
      ])
    );

    const callbacks: StreamCallbacks = {
      onSources: vi.fn(),
      onN8n: vi.fn(),
      onDone: vi.fn(),
    };

    await streamChat("/api/chat", { message: "hi" }, callbacks);

    expect(callbacks.onSources).toHaveBeenCalledWith([{ id: "doc-1", title: "Meeting", type: "item" }]);
    expect(callbacks.onN8n).toHaveBeenCalledWith(expect.objectContaining({ name: "Test WF", status: "active" }));
  });

  it("should send Accept: text/event-stream header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockSSEResponse([{ event: "done", data: { conversationId: "c1" } }])
    );

    await streamChat("/api/chat", { message: "hi" }, {});

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/chat",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "text/event-stream" }),
      })
    );
  });
});
