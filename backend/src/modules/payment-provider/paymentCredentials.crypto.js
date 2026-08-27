import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";

const VERSION = "v1";

function encryptionKey() {
  const raw = String(env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY || "").trim();
  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, "hex");
  else {
    try { key = Buffer.from(raw, "base64"); } catch { key = Buffer.alloc(0); }
  }
  if (key.length !== 32) {
    throw new AppError("Payment credential encryption is not configured", 503, "PAYMENT_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED");
  }
  return key;
}

export function encryptPaymentCredentials(credentials, context) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(String(context)));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptPaymentCredentials(value, context) {
  try {
    const [version, iv, tag, ciphertext] = String(value).split(".");
    if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error("invalid envelope");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(String(context)));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Stored payment credentials could not be decrypted", 500, "PAYMENT_CREDENTIAL_DECRYPTION_FAILED");
  }
}
