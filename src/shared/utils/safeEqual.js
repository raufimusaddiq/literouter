import crypto from "crypto";

const sha256 = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest();

/**
 * Constant-time string comparison. Both sides are hashed first so the compare
 * is over equal-length buffers and leaks neither content nor length.
 */
export function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}
