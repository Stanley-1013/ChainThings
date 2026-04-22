import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookVerifier } from "../types";

export class JiraWebhookVerifier implements WebhookVerifier {
  verify(payload: string, headers: Headers, secret: string): boolean {
    // Jira Cloud webhooks can use shared secret in X-Hub-Secret header
    // or HMAC signature depending on configuration
    const raw = headers.get("x-hub-signature");
    if (raw) {
      const sig = raw.startsWith("sha256=") ? raw.slice(7) : raw;
      const expected = createHmac("sha256", secret).update(payload).digest("hex");
      if (sig.length !== expected.length) return false;
      return timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"));
    }
    // Fallback: shared secret token comparison
    const token = headers.get("x-hub-secret") ?? headers.get("authorization");
    if (!token) return false;
    const cleanToken = token.replace(/^Bearer\s+/i, "");
    if (cleanToken.length !== secret.length) return false;
    return timingSafeEqual(
      Buffer.from(cleanToken, "utf8"),
      Buffer.from(secret, "utf8"),
    );
  }

  getDeliveryId(headers: Headers): string | null {
    return headers.get("x-request-id") ?? headers.get("x-atlassian-webhook-identifier");
  }

  getEventType(_headers: Headers, payload: unknown): string {
    const p = payload as Record<string, unknown>;
    return (p.webhookEvent as string) ?? (p.issue_event_type_name as string) ?? "unknown";
  }
}
