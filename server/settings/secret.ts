/**
 * Reversible encryption for at-rest secrets (currently the AI provider API key).
 *
 * The API key must be recoverable as plaintext to send `Authorization: Bearer …`,
 * so — unlike a password — it is ENCRYPTED (AES-256-GCM), not hashed. The 32-byte
 * key is derived from a server-side master secret (SETTINGS_ENCRYPTION_KEY, or
 * SESSION_SECRET as a fallback so existing deployments need no new config). The
 * secret NEVER leaves the server; only the ciphertext is written to app_settings.
 *
 * A stored blob is `gcm.v1:<iv>:<tag>:<ciphertext>` (each part base64). If the
 * master secret changes, old blobs simply fail to decrypt and the caller falls
 * back to the env var — a rotation degrades gracefully rather than crashing.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const MAGIC = "gcm.v1";
const KEY_SALT = "pdtc-settings-secret-v1";

/** True when a master secret is configured — required before a key can be stored. */
export function hasEncryptionSecret(): boolean {
  return Boolean(process.env.SETTINGS_ENCRYPTION_KEY || process.env.SESSION_SECRET);
}

function masterKey(): Buffer {
  const secret = process.env.SETTINGS_ENCRYPTION_KEY || process.env.SESSION_SECRET || "";
  if (!secret) {
    throw new Error(
      "No encryption secret configured — set SESSION_SECRET (or SETTINGS_ENCRYPTION_KEY) to store an API key.",
    );
  }
  return scryptSync(secret, KEY_SALT, 32);
}

/** Encrypt UTF-8 plaintext to a self-describing `gcm.v1:iv:tag:ciphertext` blob. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${MAGIC}:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** Decrypt a blob produced by encryptSecret. Returns null on any tamper/format/secret mismatch. */
export function decryptSecret(blob: string): string | null {
  try {
    const [magic, ivB64, tagB64, dataB64] = blob.split(":");
    if (magic !== MAGIC || !ivB64 || !tagB64 || !dataB64) return null;
    const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}
