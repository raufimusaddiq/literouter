export const GITLAB_COM = "https://gitlab.com";

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

export function normalizeGitLabBaseUrl(input) {
  return parseGitLabBaseUrl(input) ?? GITLAB_COM;
}
