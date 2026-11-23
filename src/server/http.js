
const JSON_CONTENT_TYPE = "application/json";
const BUN_JSON_CONTENT_TYPE = "application/json;charset=utf-8";

const bunResponseJson = Response.json.bind(Response);

export function responseJson(data, init) {
  const res = bunResponseJson(data, init);
  if (res.headers.get("content-type") === BUN_JSON_CONTENT_TYPE) res.headers.set("content-type", JSON_CONTENT_TYPE);
  return res;
}

Response.json = responseJson;

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

const jars = new WeakMap();

function decodeValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseCookieHeader(header) {
  const entries = new Map();
  for (const part of (header || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name && !entries.has(name)) entries.set(name, decodeValue(part.slice(eq + 1).trim()));
  }
  return entries;
}

export function serializeCookie(name, value, options = {}) {
  const opts = { ...options };
  if (opts.maxAge) opts.expires = new Date(Date.now() + opts.maxAge * 1000);
  if (opts.path === null || opts.path === undefined) opts.path = "/";
  const expires = typeof opts.expires === "number" ? new Date(opts.expires) : opts.expires;
  const attributes = [
    opts.path && `Path=${opts.path}`,
    (expires || expires === 0) && `Expires=${expires.toUTCString()}`,
    typeof opts.maxAge === "number" && `Max-Age=${opts.maxAge}`,
    opts.domain && `Domain=${opts.domain}`,
    opts.secure && "Secure",
    opts.httpOnly && "HttpOnly",
    opts.sameSite && `SameSite=${opts.sameSite}`,
    opts.partitioned && "Partitioned",
    opts.priority && `Priority=${opts.priority}`,
  ].filter(Boolean);
  const pair = `${name}=${encodeURIComponent(value ?? "")}`;
  return attributes.length ? `${pair}; ${attributes.join("; ")}` : pair;
}

class CookieJar {
  constructor(header) {
    this.values = parseCookieHeader(header);
    this.pending = new Map();
  }

  get(name) {
    return this.values.has(name) ? this.values.get(name) : null;
  }

  has(name) {
    return this.values.has(name);
  }

  set(name, value, options = {}) {
    this.values.set(name, String(value ?? ""));
    this.pending.set(name, serializeCookie(name, value, options));
    return this;
  }

  delete(name, options = {}) {
    this.values.delete(name);
    this.pending.set(name, serializeCookie(name, "", { ...options, expires: new Date(0) }));
  }

  toSetCookieHeaders() {
    return [...this.pending.values()];
  }
}

export function cookies(req) {
  let jar = jars.get(req);
  if (!jar) {
    jar = new CookieJar(req.headers.get("cookie"));
    jars.set(req, jar);
  }
  return jar;
}

export function applyCookies(req, res) {
  const pending = jars.get(req)?.toSetCookieHeaders();
  if (!pending?.length) return res;
  try {
    for (const line of pending) res.headers.append("Set-Cookie", line);
    return res;
  } catch {
    const headers = new Headers(res.headers);
    for (const line of pending) headers.append("Set-Cookie", line);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
}
