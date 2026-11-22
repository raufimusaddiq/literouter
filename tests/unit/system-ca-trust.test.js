import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url).pathname;
const customServer = join(root, "custom-server.js");
const dir = mkdtempSync(join(tmpdir(), "ca-trust-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Throwaway chains generated at test time; nothing sensitive is committed.
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

describe("useSystemCaStore", () => {
  const { useSystemCaStore } = createRequire(import.meta.url)(customServer);

  it("installs the system certs as the process default", () => {
    const calls = [];
    const n = useSystemCaStore({
      getCACertificates: (t) => (t === "system" ? ["a", "b"] : ["bundled"]),
      setDefaultCACertificates: (c) => calls.push(c),
    });
    expect(n).toBe(2);
    expect(calls).toEqual([["a", "b"]]);
  });

  it("fails closed on an empty system store and on a Node without the API", () => {
    const set = () => { throw new Error("must not be called"); };
    expect(() => useSystemCaStore({ getCACertificates: () => [], setDefaultCACertificates: set })).toThrow(/refusing/);
    expect(() => useSystemCaStore({})).toThrow(/Node >= 22.19/);
  });

  it("is enabled in the production image", () => {
    expect(readFileSync(join(root, "Dockerfile"), "utf8")).toMatch(/^ENV LITEROUTER_SYSTEM_CA=1$/m);
  });
});

describe("outbound clients honour the replaced default CA list", () => {
  let trusted, distrusted;
  beforeAll(() => {
    trusted = makeChain("trusted");
    distrusted = makeChain("distrusted");
  });

  // Runs in a child so setDefaultCACertificates cannot leak into other tests. The "system"
  // store is simulated with only `trusted.ca`; the server presents a chain from `distrusted`
  // (stand-in for the compromised root) or from `trusted`.
  function probe(serverMaterial) {
    const script = `
      const https = require("https"); const tls = require("tls");
      const { useSystemCaStore } = require(${JSON.stringify(customServer)});
      const m = JSON.parse(process.env.M);
      const server = https.createServer({ key: m.server.key, cert: m.server.cert }, (q, r) => r.end("ok"));
      server.listen(0, "127.0.0.1", async () => {
        const url = "https://localhost:" + server.address().port;
        useSystemCaStore({ getCACertificates: () => [m.trustedCa], setDefaultCACertificates: tls.setDefaultCACertificates });
        const out = {};
        out.fetch = await fetch(url).then(() => "ok", (e) => (e.cause && e.cause.code) || e.message);
        const { Agent, fetch: uf } = require("undici");
        out.undici = await uf(url, { dispatcher: new Agent() }).then(() => "ok", (e) => (e.cause && e.cause.code) || e.message);
        out.https = await new Promise((res) => https.get(url, () => res("ok")).on("error", (e) => res(e.code)));
        console.log(JSON.stringify(out)); server.close();
      });`;
    const r = spawnSync(process.execPath, ["-e", script], {
      cwd: root,
      env: { ...process.env, NODE_PATH: join(root, "node_modules"), M: JSON.stringify({ server: serverMaterial, trustedCa: trusted.ca }) },
      encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout.trim().split("\n").pop());
  }

  it("accepts a chain rooted in the configured store", () => {
    const out = probe(trusted);
    expect([out.fetch, out.undici, out.https]).toEqual(["ok", "ok", "ok"]);
  });

  it("rejects a chain whose root is not in the configured store, on every client", () => {
    const out = probe(distrusted);
    const verifyError = /^(UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT)/;
    expect(out.fetch).toMatch(verifyError);
    expect(out.undici).toMatch(verifyError);
    expect(out.https).toMatch(verifyError);
  });
});
