import { createHash } from "node:crypto";

export const UUID_NS_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidv5(name, namespace = UUID_NS_DNS) {
  if (typeof name !== "string") throw new TypeError("uuidv5 name must be a string");
  if (typeof namespace !== "string" || !UUID_PATTERN.test(namespace)) {
    throw new TypeError("uuidv5 namespace must be a UUID string");
  }
  const digest = createHash("sha1")
    .update(Buffer.from(namespace.replaceAll("-", ""), "hex"))
    .update(name, "utf8")
    .digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
