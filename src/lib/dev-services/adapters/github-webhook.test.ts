import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { GitHubWebhookVerifier } from "./github-webhook";

const verifier = new GitHubWebhookVerifier();
const SECRET = "my-github-webhook-secret";
const PAYLOAD = JSON.stringify({ action: "opened", number: 42 });

function makeHeaders(overrides: Record<string, string> = {}): Headers {
  return new Headers(overrides);
}

describe("GitHubWebhookVerifier.verify()", () => {
  it("returns true for a correct HMAC-SHA256 signature", () => {
    const sig = `sha256=${createHmac("sha256", SECRET).update(PAYLOAD).digest("hex")}`;
    const headers = makeHeaders({ "x-hub-signature-256": sig });
    expect(verifier.verify(PAYLOAD, headers, SECRET)).toBe(true);
  });

  it("returns false when the signature header is missing", () => {
    const headers = makeHeaders();
    expect(verifier.verify(PAYLOAD, headers, SECRET)).toBe(false);
  });

  it("returns false for an incorrect signature", () => {
    const headers = makeHeaders({ "x-hub-signature-256": "sha256=deadbeef" });
    expect(verifier.verify(PAYLOAD, headers, SECRET)).toBe(false);
  });
});

describe("GitHubWebhookVerifier.getDeliveryId()", () => {
  it("returns the value of x-github-delivery header", () => {
    const headers = makeHeaders({ "x-github-delivery": "abc-123" });
    expect(verifier.getDeliveryId(headers)).toBe("abc-123");
  });

  it("returns null when x-github-delivery header is missing", () => {
    expect(verifier.getDeliveryId(makeHeaders())).toBeNull();
  });
});

describe("GitHubWebhookVerifier.getEventType()", () => {
  it("returns x-github-event header value", () => {
    const headers = makeHeaders({ "x-github-event": "pull_request" });
    expect(verifier.getEventType(headers, {})).toBe("pull_request");
  });

  it("returns 'unknown' when x-github-event header is missing", () => {
    expect(verifier.getEventType(makeHeaders(), {})).toBe("unknown");
  });
});
