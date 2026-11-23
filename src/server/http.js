
const JSON_CONTENT_TYPE = "application/json";

export function json(body, init = {}) {
  const text = JSON.stringify(body);
  if (text === undefined) throw new TypeError("Value is not JSON serializable");
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", JSON_CONTENT_TYPE);
  return new Response(text, { ...init, headers });
}

export function redirect(url, status = 307, base) {
  const location = new URL(String(url), base === undefined ? undefined : String(base)).href;
  return new Response(null, { status, headers: { Location: location } });
}

export function nextUrl(req) {
  return new URL(req.url);
}

export function cookies(req) {
  if (req.cookies) return req.cookies;
  return new Bun.CookieMap(req.headers.get("cookie") || "");
}
