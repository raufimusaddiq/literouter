import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { useTempDataDirAtLoad } from "../helpers/tempDataDir.js";
import { mockBootCollaborators } from "../helpers/bootMocks.js";

useTempDataDirAtLoad("lr-peer-");
mockBootCollaborators();

delete process.env.NINEROUTER_PEER_TOKEN;

const { startServer } = await import("../../src/server/index.js");
const { json } = await import("../../src/server/http.js");
const { getRequestContext } = await import("../../src/server/context.js");
const { __test__: requestDetails } = await import("@/lib/db/repos/requestDetailsRepo.js");

let server;
let baseUrl;

beforeAll(async () => {
  server = await startServer({
    port: 0,
    hostname: "127.0.0.1",
    routes: {
      "/__peek": (req) => json({ headers: Object.fromEntries(req.headers), context: getRequestContext(req) }),
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

async function peek(headers = {}) {
  const res = await fetch(`${baseUrl}/__peek`, { headers });
  return res.json();
}

describe("server peer header sanitizing", () => {
  it("startServer leaves NINEROUTER_PEER_TOKEN unset", () => {
    expect(process.env.NINEROUTER_PEER_TOKEN).toBeUndefined();
  });

  it("strips a client-sent x-9r-real-ip", async () => {
    const { headers } = await peek({ "x-9r-real-ip": "203.0.113.55" });

    expect(headers["x-9r-real-ip"]).toBeUndefined();
  });

  it("does not stamp x-9r-peer-token or x-9r-real-ip", async () => {
    const { headers, context } = await peek();

    expect(headers["x-9r-peer-token"]).toBeUndefined();
    expect(headers["x-9r-real-ip"]).toBeUndefined();
    expect(context.peerIp).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
    expect(context.isLocal).toBe(true);
  });

  it("strips a client-sent x-9r-peer-token", async () => {
    const { headers } = await peek({ "x-9r-peer-token": "forged-token", "x-forwarded-for": "203.0.113.9" });

    expect(headers["x-9r-peer-token"]).toBeUndefined();
  });

  it("strips a client-sent x-9r-via-proxy", async () => {
    const { headers } = await peek({ "x-9r-via-proxy": "1" });

    expect(headers["x-9r-via-proxy"]).toBeUndefined();
  });

  it("loopback proxy hop: context.clientIp is the rightmost XFF hop and isLocal is false", async () => {
    const { headers, context } = await peek({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });

    expect(context.clientIp).toBe("10.0.0.1");
    expect(context.isLocal).toBe(false);
    expect(headers["x-forwarded-for"]).toBeUndefined();
  });

  it("keeps the peer token out of persisted request details", () => {
    const sanitized = requestDetails.sanitizeHeaders({
      "x-9r-peer-token": "secret",
      "x-9r-cli-token": "secret",
      "authorization": "Bearer sk-x",
      "x-9r-real-ip": "127.0.0.1",
    });

    expect(sanitized["x-9r-peer-token"]).toBeUndefined();
    expect(sanitized["x-9r-cli-token"]).toBeUndefined();
    expect(sanitized["authorization"]).toBeUndefined();
    expect(sanitized["x-9r-real-ip"]).toBe("127.0.0.1");
  });
});
