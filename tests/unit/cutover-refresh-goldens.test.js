import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PARITY } from "../parity/config.js";
import { applyNodeDefaults, keepReason, correctRuntimeDefaults, normalizeRecordHost, refreshGoldens } from "../../scripts/cutover/refresh-goldens.mjs";
import { compareUpstreamDirs, requestsByFixture } from "../parity/compare-upstream.mjs";

const record = (headers, body = "") => ({ seq: 0, method: "POST", path: "/v1/x", headers, bodyBase64: Buffer.from(body).toString("base64") });
const golden = (extra = {}) => ({ status: 200, headers: { "content-type": "application/json" }, body: { ok: true }, upstream: [], ...extra });

function write(dir, id, json, records = [], log = []) {
  fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify(json, null, 2)}\n`);
  log.push(...records);
}

function flush(dir, log, index) {
  fs.writeFileSync(path.join(dir, "upstream-requests.jsonl"), log.map((r) => `${JSON.stringify(r)}\n`).join(""));
  fs.writeFileSync(path.join(dir, "upstream-fixtures.jsonl"), index.map((e) => `${JSON.stringify(e)}\n`).join(""));
}

describe("normalizeRecordHost", () => {
  it("rewrites the container-side mock host to the source-run host only", () => {
    const r = normalizeRecordHost(record([["host", `host.docker.internal:${PARITY.mockPort}`], ["x-a", "host.docker.internal:1"]]));
    expect(r.headers).toEqual([["host", `127.0.0.1:${PARITY.mockPort}`], ["x-a", "host.docker.internal:1"]]);
  });
});

describe("applyNodeDefaults", () => {
  it("fills missing runtime defaults, keeps caller values and sorts headers", () => {
    const bun = applyNodeDefaults(record([["accept-encoding", "gzip, deflate, br, zstd"], ["user-agent", "Bun/1.4.4"]]));
    expect(Object.fromEntries(bun.headers)).toMatchObject({ "accept-encoding": "gzip, deflate", "user-agent": "node" });
    const r = applyNodeDefaults(record([["accept-encoding", "identity"], ["authorization", "Bearer k"], ["user-agent", "claude-cli/1"]]));
    expect(Object.fromEntries(r.headers)).toEqual({
      "accept-encoding": "identity",
      "accept-language": "*",
      authorization: "Bearer k",
      "sec-fetch-mode": "cors",
      "user-agent": "claude-cli/1",
    });
    expect(r.headers.map(([k]) => k)).toEqual([...r.headers.map(([k]) => k)].sort());
  });
});

describe("keepReason", () => {
  const rules = [{ pattern: /^trust-/, reason: "peer" }];
  it("keeps lan fixtures and rule matches, refreshes the rest", () => {
    expect(keepReason({ id: "x", peer: "lan" }, rules)).toBeTruthy();
    expect(keepReason({ id: "trust-a", peer: "loopback" }, rules)).toBe("peer");
    expect(keepReason({ id: "api-health-get", peer: "loopback" }, rules)).toBeUndefined();
  });
});

describe("correctRuntimeDefaults", () => {
  it("drops Bun's charset from the JSON content type and leaves other values", () => {
    expect(correctRuntimeDefaults(golden({ headers: { "content-type": "application/json;charset=utf-8" } })).headers["content-type"]).toBe("application/json");
    expect(correctRuntimeDefaults(golden({ headers: { "content-type": "text/html; charset=utf-8" } })).headers["content-type"]).toBe("text/html; charset=utf-8");
  });
});

describe("refreshGoldens", () => {
  it("refreshes representative fixtures, corrects peer-dependent ones and indexes records by fixture id", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "refresh-goldens-"));
    try {
      const base = path.join(root, "baseline");
      const exp = path.join(root, "expected");
      fs.mkdirSync(base);
      fs.mkdirSync(exp);
      const hostRec = (ua) => record([["host", `host.docker.internal:${PARITY.mockPort}`], ["user-agent", ua]], "b");
      const oldRec = record([["host", `127.0.0.1:${PARITY.mockPort}`], ["user-agent", "Bun/1.4.4"]], "old");
      const baseLog = [];
      const expLog = [];
      write(base, "a-image", golden({ body: { fresh: true }, upstream: [{}] }), [{ ...hostRec("node"), seq: 0 }], baseLog);
      write(base, "z-unreachable", { status: 0, headers: {}, error: "ECONNREFUSED" });
      write(exp, "a-image", golden({ headers: { "content-type": "application/json;charset=utf-8" } }), [], expLog);
      write(exp, "m-lan", golden({ headers: { "content-type": "application/json;charset=utf-8" }, upstream: [{}] }), [oldRec], expLog);
      write(exp, "trust-x", golden({ headers: { "content-type": "application/json;charset=utf-8" } }));
      write(exp, "z-unreachable", golden({ headers: { "content-type": "application/json;charset=utf-8" } }));
      flush(base, baseLog, [{ id: "a-image", from: 0, to: 1 }]);
      flush(exp, expLog, []);
      fs.rmSync(path.join(exp, "upstream-fixtures.jsonl"));
      fs.writeFileSync(path.join(exp, "upstream-requests.jsonl"), `${JSON.stringify(oldRec)}\n`);

      const fixtures = [{ id: "a-image", peer: "loopback" }, { id: "m-lan", peer: "lan" }, { id: "trust-x", peer: "loopback" }, { id: "z-unreachable", peer: "loopback" }];
      const out = refreshGoldens({ baselineDir: base, expectedDir: exp, fixtures, rules: [{ pattern: /^trust-/, reason: "peer" }] });
      expect(out.refreshed).toEqual(["a-image"]);
      expect(out.corrected).toEqual(["m-lan", "trust-x", "z-unreachable"]);

      expect(JSON.parse(fs.readFileSync(path.join(exp, "a-image.json"), "utf8")).body).toEqual({ fresh: true });
      expect(JSON.parse(fs.readFileSync(path.join(exp, "m-lan.json"), "utf8")).headers["content-type"]).toBe("application/json");
      expect(JSON.parse(fs.readFileSync(path.join(exp, "z-unreachable.json"), "utf8")).status).toBe(200);

      const byFixture = requestsByFixture(exp);
      expect(byFixture.get("a-image").map((r) => Object.fromEntries(r.headers).host)).toEqual([`127.0.0.1:${PARITY.mockPort}`]);
      const lan = Object.fromEntries(byFixture.get("m-lan")[0].headers);
      expect(lan["user-agent"]).toBe("node");
      expect(lan["accept-language"]).toBe("*");
      expect(byFixture.get("trust-x")).toEqual([]);
      expect(compareUpstreamDirs(exp, exp).diffs).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
