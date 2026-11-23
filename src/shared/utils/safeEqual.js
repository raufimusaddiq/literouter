import crypto from "crypto";

const sha256 = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest();

export function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}
