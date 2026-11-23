import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { useSystemCaStore } from "../../src/server/ca.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const proxyFetchModule = join(root, "open-sse", "utils", "proxyFetch.js");
const caModule = join(root, "src", "server", "ca.js");
const dir = mkdtempSync(join(tmpdir(), "ca-trust-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const VERIFY_ERROR = /^(UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT)/;

function makeChain(name) {
  const f = (ext) => join(dir, `${name}.${ext}`);
  const run = (...a) => execFileSync("openssl", a, { stdio: "pipe" });
  run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", f("ca.key"), "-out", f("ca.pem"),
    "-days", "2", "-subj", `/CN=Test Root ${name}`, "-addext", "basicConstraints=critical,CA:TRUE",
    "-addext", "keyUsage=critical,keyCertSign,cRLSign");
  run("req", "-newkey", "rsa:2048", "-nodes", "-keyout", f("key"), "-out", f("csr"), "-subj", "/CN=localhost");
  writeFileSync(f("ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\n");
  run("x509", "-req", "-in", f("csr"), "-CA", f("ca.pem"), "-CAkey", f("ca.key"), "-CAcreateserial",
    "-out", f("crt"), "-days", "2", "-extfile", f("ext"));
  return { ca: readFileSync(f("ca.pem"), "utf8"), key: readFileSync(f("key"), "utf8"), cert: readFileSync(f("crt"), "utf8") };
}

describe("useSystemCaStore bookkeeping", () => {
  it("installs the system certs as the process default", () => {
    const calls = [];
    const n = useSystemCaStore({
      getCACertificates: (t) => (t === "system" ? ["a", "b"] : ["bundled"]),
      setDefaultCACertificates: (c) => calls.push(c),
    }, {});
    expect(n).toBe(2);
    expect(calls).toEqual([["a", "b"]]);
  });

  it("fails closed on an empty system store", () => {
    const calls = [];
    const host = { fetch: () => {} };
    const original = host.fetch;
    expect(() => useSystemCaStore({ getCACertificates: () => [], setDefaultCACertificates: (c) => calls.push(c) }, host)).toThrow(/refusing/);
    expect(calls).toEqual([]);
    expect(host.fetch).toBe(original);
  });

  it("is enabled in the production image", () => {
    expect(readFileSync(join(root, "Dockerfile"), "utf8")).toMatch(/^ENV LITEROUTER_SYSTEM_CA=1$/m);
  });

  it("calling it twice does not wrap fetch twice and applies the latest list", async () => {
    const seen = [];
    const host = { fetch: async (input, init) => seen.push({ input, init }) };
    const tlsApi = (list) => ({ getCACertificates: () => list, setDefaultCACertificates() {} });
    useSystemCaStore(tlsApi(["first"]), host);
    const wrapped = host.fetch;
    useSystemCaStore(tlsApi(["second"]), host);
    expect(host.fetch).not.toBe(wrapped);
    await host.fetch("https://example.test/", { method: "POST" });
    expect(seen).toHaveLength(1);
    expect(seen[0].init).toEqual({ method: "POST", tls: { ca: ["second"] } });
  });

  it("a caller-supplied tls.ca is not overridden and other tls options are kept", async () => {
    const seen = [];
    const host = { fetch: async (input, init) => seen.push(init) };
    useSystemCaStore({ getCACertificates: () => ["sys"], setDefaultCACertificates() {} }, host);
    await host.fetch("https://example.test/", { tls: { ca: ["mine"] } });
    await host.fetch("https://example.test/", { tls: { rejectUnauthorized: true } });
    expect(seen[0]).toEqual({ tls: { ca: ["mine"] } });
    expect(seen[1]).toEqual({ tls: { ca: ["sys"], rejectUnauthorized: true } });
  });

  it("an empty tls.ca is treated as not supplied", async () => {
    const seen = [];
    const host = { fetch: async (input, init) => seen.push(init) };
    useSystemCaStore({ getCACertificates: () => ["sys"], setDefaultCACertificates() {} }, host);
    await host.fetch("https://example.test/", { tls: { ca: [] } });
    expect(seen[0]).toEqual({ tls: { ca: ["sys"] } });
  });
});

describe("outbound clients honour the configured system store under Bun", () => {
  let trusted, distrusted;
  beforeAll(() => {
    trusted = makeChain("trusted");
    distrusted = makeChain("distrusted");
  });

  function probe(serverMaterial, ownCa) {
    const script = `
      const tls = require("node:tls");
      const https = require("node:https");
      const { useSystemCaStore } = await import(${JSON.stringify(caModule)});
      const m = JSON.parse(process.env.M);
      const server = Bun.serve({ port: 0, hostname: "127.0.0.1", tls: { key: m.server.key, cert: m.server.cert }, fetch: () => new Response("ok") });
      const url = "https://localhost:" + server.port;
      const code = (e) => (e.cause && e.cause.code) || e.code || e.message;
      const out = {};
      out.count = useSystemCaStore({ getCACertificates: () => [m.trustedCa], setDefaultCACertificates: tls.setDefaultCACertificates });
      out.fetch = await fetch(url).then(() => "ok", code);
      out.https = await new Promise((res) => https.get(url, () => res("ok")).on("error", (e) => res(code(e))));
      out.own = await fetch(url, { tls: { ca: m.server.ca } }).then(() => "ok", code);
      console.log(JSON.stringify(out));
      server.stop(true);
    `;
    const r = spawnSync(process.execPath, ["-e", script], {
      cwd: root,
      env: { ...process.env, M: JSON.stringify({ server: serverMaterial, trustedCa: trusted.ca, ownCa }) },
      encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout.trim().split("\n").pop());
  }

  it("global fetch accepts a chain rooted in the configured store", () => {
    const out = probe(trusted);
    expect(out.count).toBe(1);
    expect(out.fetch).toBe("ok");
  });

  it("global fetch rejects a chain whose root is not in the configured store", () => {
    const out = probe(distrusted);
    expect(out.fetch).toMatch(VERIFY_ERROR);
  });

  it("node:https clients honour the replaced default list", () => {
    expect(probe(trusted).https).toBe("ok");
    expect(probe(distrusted).https).toMatch(VERIFY_ERROR);
  });

  function probeProxyFetch(serverMaterial) {
    const script = `
      const tls = require("node:tls");
      const { proxyAwareFetch } = await import(${JSON.stringify(proxyFetchModule)});
      const { useSystemCaStore } = await import(${JSON.stringify(caModule)});
      const m = JSON.parse(process.env.M);
      const server = Bun.serve({ port: 0, hostname: "127.0.0.1", tls: { key: m.server.key, cert: m.server.cert }, fetch: () => new Response("ok") });
      const url = "https://localhost:" + server.port;
      const code = (e) => (e.cause && e.cause.code) || e.code || e.message;
      useSystemCaStore({ getCACertificates: () => [m.trustedCa], setDefaultCACertificates: tls.setDefaultCACertificates });
      const out = { proxyAware: await proxyAwareFetch(url).then(() => "ok", code) };
      console.log(JSON.stringify(out));
      server.stop(true);
    `;
    const r = spawnSync(process.execPath, ["-e", script], {
      cwd: root,
      env: { ...process.env, M: JSON.stringify({ server: serverMaterial, trustedCa: trusted.ca }) },
      encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout.trim().split(String.fromCharCode(10)).pop());
  }

  it("proxyAwareFetch imported before the store is installed accepts a trusted chain", () => {
    expect(probeProxyFetch(trusted).proxyAware).toBe("ok");
  });

  it("proxyAwareFetch imported before the store is installed rejects a distrusted chain", () => {
    expect(probeProxyFetch(distrusted).proxyAware).toMatch(VERIFY_ERROR);
  });

  it("a per-request tls.ca still wins over the configured store", () => {
    expect(probe(distrusted).own).toBe("ok");
  });
});
