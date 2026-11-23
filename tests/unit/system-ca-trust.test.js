import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const customServer = join(root, "custom-server.js");
const dir = mkdtempSync(join(tmpdir(), "ca-trust-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

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
  return { caPath: f("ca.pem"), key: readFileSync(f("key"), "utf8"), cert: readFileSync(f("crt"), "utf8") };
}

describe("outbound clients honour the configured extra CA store under Bun", () => {
  let trusted, distrusted;
  beforeAll(() => {
    trusted = makeChain("trusted");
    distrusted = makeChain("distrusted");
  });

  function probe(serverMaterial) {
    const script = `
      const https = require("https");
      const m = JSON.parse(process.env.M);
      const server = https.createServer({ key: m.key, cert: m.cert }, (q, r) => r.end("ok"));
      server.listen(0, "127.0.0.1", async () => {
        const url = "https://localhost:" + server.address().port;
        const out = {};
        out.fetch = await fetch(url).then(() => "ok", (e) => (e.cause && e.cause.code) || e.code || e.message);
        const { Agent, fetch: uf } = require("undici");
        out.undici = await uf(url, { dispatcher: new Agent() }).then(() => "ok", (e) => (e.cause && e.cause.code) || e.code || e.message);
        out.https = await new Promise((res) => https.get(url, () => res("ok")).on("error", (e) => res(e.code)));
        console.log(JSON.stringify(out)); server.close();
      });`;
    const r = spawnSync(process.execPath, ["-e", script], {
      cwd: root,
      env: { ...process.env, NODE_PATH: join(root, "node_modules"), NODE_EXTRA_CA_CERTS: trusted.caPath, M: JSON.stringify({ key: serverMaterial.key, cert: serverMaterial.cert }) },
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
