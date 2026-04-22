import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookVerifier } from "../types";

export class GitHubWebhookVerifier implements WebhookVerifier {
  verify(payload: string, headers: Headers, secret: string): boolean {
    const signature = headers.get("x-hub-signature-256");
    if (!signature) return false;
    const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
    if (expected.length !== signature.length) return false;
    return timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signature, "utf8"),
    );
  }

  getDeliveryId(headers: Headers): string | null {
    return headers.get("x-github-delivery");
  }

  getEventType(headers: Headers, _payload: unknown): string {
    return headers.get("x-github-event") ?? "unknown";
  }
}
