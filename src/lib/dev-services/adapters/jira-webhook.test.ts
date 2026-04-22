import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { JiraWebhookVerifier } from "./jira-webhook";

const verifier = new JiraWebhookVerifier();
const SECRET = "jira-shared-secret";
const PAYLOAD = JSON.stringify({ webhookEvent: "jira:issue_updated" });

function makeHeaders(overrides: Record<string, string> = {}): Headers {
  return new Headers(overrides);
}

describe("JiraWebhookVerifier.verify()", () => {
  it("returns true for correct HMAC with x-hub-signature header", () => {
    const hmac = createHmac("sha256", SECRET).update(PAYLOAD).digest("hex");
    const headers = makeHeaders({ "x-hub-signature": hmac });
    expect(verifier.verify(PAYLOAD, headers, SECRET)).toBe(true);
  });

  it("returns true using shared-secret x-hub-secret header (token comparison)", () => {
    const headers = makeHeaders({ "x-hub-secret": SECRET });
    expect(verifier.verify(PAYLOAD, headers, SECRET)).toBe(true);
  });

  it("returns false when no authentication header is present", () => {
    const headers = makeHeaders();
    expect(verifier.verify(PAYLOAD, headers, SECRET)).toBe(false);
  });

  it("returns false for an incorrect x-hub-signature", () => {
    const headers = makeHeaders({ "x-hub-signature": "badhmacsignature00000000000000000000000000000000000000000000000000" });
    expect(verifier.verify(PAYLOAD, headers, SECRET)).toBe(false);
  });
});

describe("JiraWebhookVerifier.getEventType()", () => {
  it("returns payload.webhookEvent when present", () => {
    const payload = { webhookEvent: "jira:issue_created" };
    expect(verifier.getEventType(makeHeaders(), payload)).toBe("jira:issue_created");
  });

  it("returns 'unknown' when payload has no webhookEvent", () => {
    expect(verifier.getEventType(makeHeaders(), {})).toBe("unknown");
  });
});
