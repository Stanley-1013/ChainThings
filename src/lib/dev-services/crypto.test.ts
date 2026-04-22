import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecretConfig, decryptSecretConfig } from "./crypto";

// Save and restore env around tests that mutate it
const ORIGINAL_KEY = process.env.DEV_SERVICE_ENCRYPTION_KEY;

// Generate a valid 32-byte base64 key once
const VALID_KEY_B64 = randomBytes(32).toString("base64");

beforeAll(() => {
  process.env.DEV_SERVICE_ENCRYPTION_KEY = VALID_KEY_B64;
});

afterEach(() => {
  // Restore a valid key after any test that may have removed/changed it
  process.env.DEV_SERVICE_ENCRYPTION_KEY = VALID_KEY_B64;
});

describe("encryptSecretConfig / decryptSecretConfig", () => {
  it("round-trips correctly: encrypt then decrypt returns the original config", () => {
    const config = { access_token: "foo", refresh_token: "bar" };
    const encrypted = encryptSecretConfig(config);
    const decrypted = decryptSecretConfig(encrypted);
    expect(decrypted).toEqual(config);
  });

  it("produces a different ciphertext on each call (different IV per call)", () => {
    const config = { access_token: "same-value" };
    const enc1 = encryptSecretConfig(config);
    const enc2 = encryptSecretConfig(config);
    expect(enc1.toString("hex")).not.toBe(enc2.toString("hex"));
  });

  it("decryptSecretConfig throws on too-short input", () => {
    const tooShort = Buffer.alloc(10); // IV=12+TAG=16 bytes minimum needed
    expect(() => decryptSecretConfig(tooShort)).toThrow();
  });

  it("decryptSecretConfig throws when authentication tag is corrupted (byte-flip)", () => {
    const config = { access_token: "hello" };
    const encrypted = encryptSecretConfig(config);
    // Flip a byte inside the tag region (bytes 12–27)
    const corrupted = Buffer.from(encrypted);
    corrupted[12] = corrupted[12] ^ 0xff;
    expect(() => decryptSecretConfig(corrupted)).toThrow();
  });

  it("encryptSecretConfig throws when DEV_SERVICE_ENCRYPTION_KEY is not set", () => {
    delete process.env.DEV_SERVICE_ENCRYPTION_KEY;
    expect(() => encryptSecretConfig({ access_token: "x" })).toThrow(
      /DEV_SERVICE_ENCRYPTION_KEY/,
    );
  });

  it("encryptSecretConfig throws when key is not 32 bytes after base64 decode", () => {
    // 16-byte key encoded as base64 — wrong length
    process.env.DEV_SERVICE_ENCRYPTION_KEY = randomBytes(16).toString("base64");
    expect(() => encryptSecretConfig({ access_token: "x" })).toThrow(
      /32 bytes/,
    );
  });
});

// Restore original key after all crypto tests to avoid polluting other suites
afterEach(() => {
  if (ORIGINAL_KEY !== undefined) {
    process.env.DEV_SERVICE_ENCRYPTION_KEY = ORIGINAL_KEY;
  } else {
    delete process.env.DEV_SERVICE_ENCRYPTION_KEY;
  }
});
