const OPENCLAW_URL = process.env.OPENCLAW_GATEWAY_URL!;
const OPENCLAW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN!;

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

export async function chatCompletion(
  messages: ChatMessage[],
  userId?: string
): Promise<ChatCompletionResponse> {
  const res = await fetch(`${OPENCLAW_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENCLAW_TOKEN}`,
    },
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
}
