import crypto from "crypto";
import fs from "fs";
import { resolveAppPath } from "./app-root";

const KEY_PATH = resolveAppPath("secret.key");

function loadKey(): Buffer {
  const keyB64 = fs.readFileSync(KEY_PATH, "utf-8").trim();
  return Buffer.from(keyB64, "base64");
}

export function encryptPin(pin: string): string {
  const key = loadKey();
  const signingKey = key.subarray(0, 16);
  const encryptionKey = key.subarray(16, 32);
  const iv = crypto.randomBytes(16);
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));
  const cipher = crypto.createCipheriv("aes-128-cbc", encryptionKey, iv);
  const padded = Buffer.concat([cipher.update(pin, "utf-8"), cipher.final()]);
  const version = Buffer.from([0x80]);
  const payload = Buffer.concat([version, timestamp, iv, padded]);
  const hmac = crypto.createHmac("sha256", signingKey).update(payload).digest();
  return Buffer.concat([payload, hmac]).toString("base64url") + "=";
}

export function decryptPin(token: string): string | null {
  try {
    const key = loadKey();
    const signingKey = key.subarray(0, 16);
    const encryptionKey = key.subarray(16, 32);
    let tokenClean = token.trim();
    tokenClean = tokenClean.replace(/-/g, "+").replace(/_/g, "/");
    while (tokenClean.length % 4 !== 0) tokenClean += "=";
    const data = Buffer.from(tokenClean, "base64");
    if (data[0] !== 0x80) return null;
    const payload = data.subarray(0, data.length - 32);
    const sig = data.subarray(data.length - 32);
    const expected = crypto.createHmac("sha256", signingKey).update(payload).digest();
    if (!crypto.timingSafeEqual(sig, expected)) return null;
    const iv = payload.subarray(9, 25);
    const ciphertext = payload.subarray(25);
    const decipher = crypto.createDecipheriv("aes-128-cbc", encryptionKey, iv);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf-8");
  } catch {
    return null;
  }
}

export function isEncrypted(value: string): boolean {
  if (!value || value.trim().length <= 4) return false;
  return value.trim().length > 10;
}

export function verifyPin(storedPin: string, inputPin: string): boolean {
  if (isEncrypted(storedPin)) {
    const decrypted = decryptPin(storedPin);
    return decrypted === inputPin;
  }
  return storedPin.trim() === inputPin.trim();
}
