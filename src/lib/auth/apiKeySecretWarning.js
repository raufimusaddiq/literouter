export const DEFAULT_API_KEY_SECRET = "endpoint-proxy-api-key-secret";

export function isWeakApiKeySecret(value = process.env.API_KEY_SECRET) {
  const v = String(value ?? "").trim();
  return !v || v === DEFAULT_API_KEY_SECRET;
}

export function warnIfWeakApiKeySecret(logFn = console.warn) {
  if (!isWeakApiKeySecret()) return false;
  logFn(
    "\n" + "!".repeat(72) +
    "\n[SECURITY] API_KEY_SECRET is empty or the public .env.example default." +
    "\nAnyone can compute legacy key checksums / client fingerprints. Set a long" +
    "\nrandom API_KEY_SECRET (note: changing it re-labels client fingerprints)." +
    "\n" + "!".repeat(72) + "\n",
  );
  return true;
}
