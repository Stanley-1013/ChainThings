import { timingSafeEqual } from "node:crypto";
import type { WebhookVerifier } from "../types";

export class GitLabWebhookVerifier implements WebhookVerifier {
  verify(_payload: string, headers: Headers, secret: string): boolean {
    const token = headers.get("x-gitlab-token");
    if (!token) return false;
    // Lengths must match for timingSafeEqual
    if (token.length !== secret.length) return false;
    return timingSafeEqual(
      Buffer.from(token, "utf8"),
      Buffer.from(secret, "utf8"),
    );
  }

  getDeliveryId(headers: Headers): string | null {
    return headers.get("x-gitlab-event-uuid");
  }

  getEventType(headers: Headers, _payload: unknown): string {
    return headers.get("x-gitlab-event") ?? "unknown";
  }
}
