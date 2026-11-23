import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { useTempDataDirAtLoad } from "../helpers/tempDataDir.js";
import { mockBootCollaborators } from "../helpers/bootMocks.js";

useTempDataDirAtLoad("lr-params-routes-");
mockBootCollaborators();
process.env.INITIAL_PASSWORD = "correct-horse";

const { startServer } = await import("../../src/server/index.js");
const { createProviderConnection } = await import("../../src/lib/db/index.js");

let server;
let base;
let connection;
let session;

const api = (path, init = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { cookie: session, ...(init.headers || {}) } });

const encodeAll = (value) =>
  [...value].map((ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, "0")}`).join("");

beforeAll(async () => {
  server = await startServer({ port: 0, hostname: "127.0.0.1" });
  base = `http://127.0.0.1:${server.port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify({ password: "correct-horse" }),
  });
  session = login.headers.getSetCookie().find((c) => c.startsWith("auth_token=")).split(";")[0];
  connection = await createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "params-fixture",
    apiKey: "sk-params-fixture",
  });
});

afterAll(() => {
  server.stop(true);
});

describe("dynamic route params", () => {
  it("providers/[id] GET resolves params.id", async () => {
    const res = await api(`/api/providers/${connection.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connection.id).toBe(connection.id);
    expect(body.connection.name).toBe("params-fixture");
    expect(body.connection.apiKey).toBeUndefined();

    const missing = await api(`/api/providers/no-such-connection`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Connection not found" });
  });

  it("oauth/[provider]/[action] resolves both", async () => {
    const unknown = await api(`/api/oauth/codex/poll-status?state=nope`);
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ status: "unknown" });

    const unsupported = await api(`/api/oauth/github/poll-status?state=nope`);
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).error).toMatch(/Poll only supported/);

    const missingState = await api(`/api/oauth/codex/poll-status`);
    expect(missingState.status).toBe(400);
    expect(await missingState.json()).toEqual({ error: "Missing state" });
  });

  it("usage/[connectionId]/codex-reset-credits resolves connectionId", async () => {
    const found = await api(`/api/usage/${connection.id}/codex-reset-credits`);
    expect(found.status).toBe(400);
    expect((await found.json()).error).toMatch(/only available for Codex connections/);

    const missing = await api(`/api/usage/no-such-connection/codex-reset-credits`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Connection not found" });
  });

  it("oauth/codex/bulk-import is not swallowed by [provider]/[action]", async () => {
    const res = await api(`/api/oauth/codex/bulk-import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([]),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No accounts provided" });
  });

  it("percent-encoded id is decoded", async () => {
    const res = await api(`/api/providers/${encodeAll(connection.id)}`);
    expect(res.status).toBe(200);
    expect((await res.json()).connection.id).toBe(connection.id);

    const oauth = await api(`/api/oauth/${encodeAll("codex")}/${encodeAll("poll-status")}?state=nope`);
    expect(oauth.status).toBe(200);
    expect(await oauth.json()).toEqual({ status: "unknown" });
  });
});
