import {
  getDefaultProvider,
  getProviderConfig,
  type AiProvider,
} from "./providers";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatCompletionOptions {
  provider?: AiProvider;
  token?: string;
  tenantId?: string;
  model?: string;
  requireTenantToken?: boolean;
}

export interface ChatCompletionResponse {
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

export function buildZeroClawPrompt(messages: ChatMessage[]): string {
  const systemParts = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content);
  const nonSystem = messages.filter((m) => m.role !== "system");

  const parts: string[] = [];
  if (systemParts.length > 0) {
    parts.push(systemParts.join("\n\n"));
  }

  if (nonSystem.length === 1 && nonSystem[0].role === "user") {
    parts.push(nonSystem[0].content);
  } else {
    for (const msg of nonSystem) {
      const label = msg.role === "user" ? "User" : "Assistant";
      parts.push(`${label}: ${msg.content}`);
    }
  }

  return parts.join("\n\n");
}

export async function chatCompletion(
  messages: ChatMessage[],
  userId?: string,
  options?: ChatCompletionOptions
): Promise<ChatCompletionResponse> {
  const provider = options?.provider ?? getDefaultProvider();
  const config = getProviderConfig(provider);
  const token = options?.token || config.defaultToken;

  if (options?.requireTenantToken && !options.token) {
    throw new Error(
      "Tenant-specific AI token required but not configured"
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (
    config.supportsTenantHeader &&
    options?.tenantId &&
    config.tenantHeaderName
  ) {
    headers[config.tenantHeaderName] = options.tenantId;
  }

  const url = `${config.baseUrl}${config.chatEndpoint}`;
  let body: string;

  if (config.requestFormat === "zeroclaw") {
    // Use native context + history params for structured multi-turn
    const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content.trim()).filter(Boolean);
    const nonSystem = messages.filter((m) => m.role !== "system");
    const lastMsg = nonSystem[nonSystem.length - 1];

    if (lastMsg && lastMsg.role === "user") {
      const history = nonSystem.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
      body = JSON.stringify({
        message: lastMsg.content,
        ...(systemParts.length > 0 && { context: systemParts.join("\n\n") }),
        ...(history.length > 0 && { history }),
      });
    } else {
      body = JSON.stringify({ message: buildZeroClawPrompt(messages) });
    }
  } else {
    body = JSON.stringify({
      model: options?.model || config.defaultModel,
      messages,
      stream: false,
      ...(userId && { user: userId }),
    });
  }

  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const chatTimeout = config.chatTimeoutMs ?? config.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), chatTimeout);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        // Retry on 500/502/503 (upstream transient errors)
        if (res.status >= 500 && attempt < MAX_RETRIES - 1) {
          clearTimeout(timer);
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw new Error(`${provider} error ${res.status}: ${text}`);
      }

      if (config.requestFormat === "zeroclaw") {
        const data: { response: string; model?: string } = await res.json();
        return {
          id: `zc-${Date.now()}`,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: data.response },
              finish_reason: "stop",
            },
          ],
        };
      } else {
        return res.json();
      }
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(
          `${provider} request timed out after ${chatTimeout}ms`
        );
      }
      // Retry on network errors
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`${provider} failed after ${MAX_RETRIES} attempts`);
}
