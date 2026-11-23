export const DEFAULT_BODY_LIMIT_BYTES = 128 * 1024 * 1024;

const UNITS = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

export function parseBodyLimit(raw) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(String(raw ?? ""));
  if (!match) return DEFAULT_BODY_LIMIT_BYTES;
  return Math.floor(Number(match[1]) * UNITS[(match[2] || "b").toLowerCase()]);
}
