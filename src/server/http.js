export function json(body, init = {}) {
  return Response.json(body, init);
}

export function redirect(url, status = 307, base) {
  const raw = String(url);
  const location = base ? new URL(raw, String(base)).href : URL.canParse(raw) ? new URL(raw).href : raw;
  return new Response(null, { status, headers: { Location: location } });
}

export function nextUrl(req) {
  return new URL(req.url);
}

export function cookies(req) {
  if (req.cookies) return req.cookies;
  return new Bun.CookieMap(req.headers.get("cookie") || "");
}
