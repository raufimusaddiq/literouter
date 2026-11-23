import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { useTempDataDirAtLoad } from "../helpers/tempDataDir.js";
import { mockBootCollaborators } from "../helpers/bootMocks.js";

useTempDataDirAtLoad("lr-auth-cookies-");
mockBootCollaborators();
process.env.INITIAL_PASSWORD = "correct-horse";
delete process.env.AUTH_COOKIE_SECURE;

const { startServer } = await import("../../src/server/index.js");

const LOGIN_COOKIE =
  /^auth_token=[^;\s]+; Path=\/; Expires=[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT; Max-Age=86400; HttpOnly; SameSite=lax$/;
const SECURE_LOGIN_COOKIE =
  /^auth_token=[^;\s]+; Path=\/; Expires=[^;]+; Max-Age=86400; Secure; HttpOnly; SameSite=lax$/;

let server;
let base;
let nextOctet = 10;

function remote() {
  return { "x-forwarded-for": `203.0.113.${nextOctet++}` };
}

function login(password, headers = {}) {
  return fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ password }),
  });
}

function cookieValue(res, name) {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return line ? line.split(";")[0] : null;
}

beforeAll(async () => {
  server = await startServer({ port: 0, hostname: "127.0.0.1" });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

afterEach(() => {
  delete process.env.AUTH_COOKIE_SECURE;
});

describe("dashboard auth cookies", () => {
  it("login sets auth_token with HttpOnly, SameSite=Lax, Path=/, Max-Age=86400", async () => {
    const res = await login("correct-horse", remote());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, mustChangePassword: false });
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(LOGIN_COOKIE);
    expect(cookies[0]).toMatch(/SameSite=lax/i);
  });

  it("login over x-forwarded-proto: https adds Secure, and AUTH_COOKIE_SECURE=true adds it without the header", async () => {
    const proxied = await login("correct-horse", { ...remote(), "x-forwarded-proto": "https" });
    expect(proxied.headers.getSetCookie()[0]).toMatch(SECURE_LOGIN_COOKIE);

    process.env.AUTH_COOKIE_SECURE = "true";
    const forced = await login("correct-horse", remote());
    expect(forced.headers.getSetCookie()[0]).toMatch(SECURE_LOGIN_COOKIE);
  });

  it("login without either has no Secure", async () => {
    const res = await login("correct-horse", remote());
    expect(res.headers.getSetCookie()[0]).not.toMatch(/Secure/i);
  });

  it("logout expires auth_token on Path=/", async () => {
    const res = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: remote() });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.getSetCookie()).toEqual(["auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"]);
  });

  it("auth/status reads the cookie", async () => {
    const anonymous = await fetch(`${base}/api/auth/status`, { headers: remote() });
    expect((await anonymous.json()).authenticated).toBe(false);

    const session = cookieValue(await login("correct-horse", remote()), "auth_token");
    expect(session).toBeTruthy();
    const authed = await fetch(`${base}/api/auth/status`, { headers: { ...remote(), cookie: session } });
    expect((await authed.json()).authenticated).toBe(true);
  });

  it("a valid auth_token cookie passes the dashboard guard", async () => {
    const headers = remote();
    expect((await fetch(`${base}/api/settings`, { headers })).status).toBe(401);
    const session = cookieValue(await login("correct-horse", headers), "auth_token");
    const res = await fetch(`${base}/api/settings`, { headers: { ...headers, cookie: session } });
    expect(res.status).toBe(200);
  });

  it("locale sets locale with Path=/ and a one-year Max-Age", async () => {
    const res = await fetch(`${base}/api/locale`, {
      method: "POST",
      headers: { "content-type": "application/json", ...remote() },
      body: JSON.stringify({ locale: "en" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, locale: "en" });
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^locale=en; Path=\/; Expires=[^;]+; Max-Age=31536000$/);
  });

  it("login response carries Cache-Control: no-store", async () => {
    const res = await login("correct-horse", remote());
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("wrong password: 401 with remainingBeforeLock, 6th attempt 429 with Retry-After", async () => {
    const headers = remote();
    const first = await login("nope", headers);
    expect(first.status).toBe(401);
    expect(first.headers.getSetCookie()).toEqual([]);
    expect((await first.json()).remainingBeforeLock).toBe(4);
    for (let i = 0; i < 4; i++) await login("nope", headers);
    const sixth = await login("nope", headers);
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await sixth.json()).retryAfter).toBeGreaterThan(0);
  });
});
