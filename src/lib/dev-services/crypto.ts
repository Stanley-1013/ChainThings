import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { DevServiceSecretConfig } from "./types";
import { DevServiceError } from "./types";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.DEV_SERVICE_ENCRYPTION_KEY;
  if (!raw) throw new Error("DEV_SERVICE_ENCRYPTION_KEY not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new Error("DEV_SERVICE_ENCRYPTION_KEY must be 32 bytes (base64)");
  return key;
}

export function encryptSecretConfig(config: DevServiceSecretConfig): Buffer {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(config), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: [iv (12)] [tag (16)] [ciphertext (...)]
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptSecretConfig(data: Buffer): DevServiceSecretConfig {
  if (data.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new DevServiceError("crypto", "Invalid encrypted payload: too short");
  }
  const key = getKey();
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as DevServiceSecretConfig;
  } catch {
    throw new DevServiceError(
      "crypto",
      "Failed to decrypt credentials — key mismatch or corrupted data",
    );
  }
}
