export function stripNullBytes(value) {
  if (typeof value !== "string") return value;
  if (!value.includes("\0")) return value;
  return value.replace(/\0/g, "");
}
