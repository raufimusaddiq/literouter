const SECRET_PARAM_RE = /([?&](?:key|api_key|apikey|access_token|token)=)[^&#\s"']*/gi;

export function redactUrlSecrets(text) {
  if (typeof text !== "string" || !text.includes("=")) return text;
  return text.replace(SECRET_PARAM_RE, "$1[REDACTED]");
}
