export interface StreamCallbacks {
  onStatus?: (phase: "searching" | "thinking") => void;
  onDelta?: (content: string) => void;
  onSources?: (sources: Array<{ id: string; title: string | null; type: string }>) => void;
  onN8n?: (result: {
    name: string;
    n8nWorkflowId: string | null;
    status: string;
    error?: string | null;
    editorUrl?: string | null;
  }) => void;
  onDone?: (data: { conversationId: string }) => void;
  onError?: (error: string) => void;
}

/**
 * SSE client that uses fetch + getReader() to support POST body streaming.
 * Handles multi-line data fields and UTF-8 chunk splits.
 */
export async function streamChat(
  url: string,
  body: Record<string, unknown>,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    let errorMsg = "Failed to send message";
    try {
      const data = await res.json();
      errorMsg = data.error || errorMsg;
    } catch {
      /* use default */
    }
    callbacks.onError?.(errorMsg);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    callbacks.onError?.("No response stream available");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let currentData = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line === "") {
          // Dispatch event on empty line (event boundary)
          if (currentEvent && currentData) {
            try {
              const data = JSON.parse(currentData);
              switch (currentEvent) {
                case "status":
                  callbacks.onStatus?.(data.phase);
                  break;
                case "delta":
                  callbacks.onDelta?.(data.content);
                  break;
                case "sources":
                  callbacks.onSources?.(data);
                  break;
                case "n8n":
                  callbacks.onN8n?.(data);
                  break;
                case "done":
                  callbacks.onDone?.(data);
                  break;
                case "error":
                  callbacks.onError?.(data.message);
                  break;
              }
            } catch (e) {
              console.error("Error parsing SSE data:", currentData, e);
            }
          }
          currentEvent = "";
          currentData = "";
        } else if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const data = line.slice(6);
          currentData += (currentData ? "\n" : "") + data;
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return;
    }
    callbacks.onError?.(err instanceof Error ? err.message : String(err));
  } finally {
    reader.releaseLock();
  }
}
