const OPENCLAW_URL = process.env.OPENCLAW_GATEWAY_URL!;
const OPENCLAW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN!;
const OPENCLAW_TIMEOUT_MS = Number(process.env.OPENCLAW_TIMEOUT_MS) || 30_000;

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ChatCompletionResponse {
  id: string;
  choices: {
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionOptions {
  token?: string;
  tenantId?: string;
  requireTenantToken?: boolean;
}

export async function chatCompletion(
  messages: ChatMessage[],
  userId?: string,
  options?: ChatCompletionOptions
): Promise<ChatCompletionResponse> {
  if (options?.requireTenantToken && !options.token) {
    throw new Error(
      "Tenant-specific OpenClaw token required but not configured"
    );
  }
  const token = options?.token || OPENCLAW_TOKEN;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (options?.tenantId) {
    headers["x-tenant-id"] = options.tenantId;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENCLAW_TIMEOUT_MS);
  try {
    const res = await fetch(`${OPENCLAW_URL}/v1/chat/completions`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: "openclaw:main",
        messages,
        stream: false,
        ...(userId && { user: userId }),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenClaw error ${res.status}: ${text}`);
    }

    return res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `OpenClaw request timed out after ${OPENCLAW_TIMEOUT_MS}ms`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
