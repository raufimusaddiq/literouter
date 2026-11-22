export const GITLAB_COM = "https://gitlab.com";

/**
 * Parse a user-typed GitLab base URL. Empty input -> GITLAB_COM.
 * Returns null when the input is non-empty but not an http(s) URL.
 * Otherwise returns origin + pathname without a trailing slash.
 */
export function parseGitLabBaseUrl(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return GITLAB_COM;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** Safe for building links: falls back to GITLAB_COM for anything invalid. */
export function normalizeGitLabBaseUrl(input) {
  return parseGitLabBaseUrl(input) ?? GITLAB_COM;
}
