import fs from "node:fs";
import path from "node:path";
import { PARITY } from "../../tests/parity/config.js";
import { loadFixtures } from "../../tests/parity/record.mjs";
import { UPSTREAM_INDEX, UPSTREAM_LOG, requestsByFixture } from "../../tests/parity/compare-upstream.mjs";
import { NODE_FETCH_DEFAULT_HEADERS } from "../../open-sse/utils/proxyFetch.js";

const BUN_JSON_CONTENT_TYPE = "application/json;charset=utf-8";
const IMAGE_MOCK_HOST = `host.docker.internal:${PARITY.mockPort}`;
const SOURCE_MOCK_HOST = `127.0.0.1:${PARITY.mockPort}`;

const BUN_ACCEPT_ENCODING = "gzip, deflate, br, zstd";
const BUN_USER_AGENT = /^Bun\//;

export function loadKeepRules(file = new URL("./golden-keep.json", import.meta.url)) {
  return JSON.parse(fs.readFileSync(file, "utf8")).map((rule) => ({ ...rule, pattern: new RegExp(rule.match) }));
}

export function keepReason(fixture, rules) {
  if (fixture.peer === "lan") return "peer locality: the image run cannot reach the host LAN address";
  return rules.find((rule) => rule.pattern.test(fixture.id))?.reason;
}

export function normalizeRecordHost(record) {
  return { ...record, headers: record.headers.map(([k, v]) => (k.toLowerCase() === "host" && v === IMAGE_MOCK_HOST ? [k, SOURCE_MOCK_HOST] : [k, v])) };
}

export function applyNodeDefaults(record) {
  const bunDefault = ([k, v]) => (k.toLowerCase() === "accept-encoding" && v === BUN_ACCEPT_ENCODING) || (k.toLowerCase() === "user-agent" && BUN_USER_AGENT.test(v));
  const kept = record.headers.filter((h) => !bunDefault(h));
  const present = new Set(kept.map(([k]) => k.toLowerCase()));
  const added = Object.entries(NODE_FETCH_DEFAULT_HEADERS).filter(([k]) => !present.has(k));
  const headers = [...kept, ...added].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { ...record, headers };
}

export function correctRuntimeDefaults(golden) {
  const out = { ...golden, headers: { ...golden.headers } };
  if (out.headers["content-type"] === BUN_JSON_CONTENT_TYPE) out.headers["content-type"] = "application/json";
  return out;
}

export function refreshGoldens({ baselineDir, expectedDir, fixtures = loadFixtures(), rules = loadKeepRules() }) {
  const peerDependent = new Set(fixtures.filter((fx) => keepReason(fx, rules)).map((fx) => fx.id));
  const baselineRequests = requestsByFixture(baselineDir);
  const expectedRequests = requestsByFixture(expectedDir);
  const ids = fs.readdirSync(expectedDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
  const refreshed = [];
  const corrected = [];
  const records = [];
  const index = [];
  const writes = [];
  for (const id of ids) {
    const basePath = path.join(baselineDir, `${id}.json`);
    const base = fs.existsSync(basePath) ? JSON.parse(fs.readFileSync(basePath, "utf8")) : undefined;
    const usable = base && base.status !== 0 && !base.error && !peerDependent.has(id);
    let upstream;
    if (usable) {
      refreshed.push(id);
      writes.push([id, base]);
      upstream = (baselineRequests.get(id) ?? []).map(normalizeRecordHost);
    } else {
      corrected.push(id);
      const old = JSON.parse(fs.readFileSync(path.join(expectedDir, `${id}.json`), "utf8"));
      writes.push([id, correctRuntimeDefaults(old)]);
      upstream = (expectedRequests.get(id) ?? []).map(normalizeRecordHost).map(applyNodeDefaults);
    }
    index.push({ id, from: records.length, to: records.length + upstream.length });
    for (const r of upstream) records.push({ ...r, seq: records.length });
  }
  for (const [id, golden] of writes) fs.writeFileSync(path.join(expectedDir, `${id}.json`), `${JSON.stringify(golden, null, 2)}\n`);
  fs.writeFileSync(path.join(expectedDir, UPSTREAM_LOG), records.map((r) => `${JSON.stringify(r)}\n`).join(""));
  fs.writeFileSync(path.join(expectedDir, UPSTREAM_INDEX), index.map((e) => `${JSON.stringify(e)}\n`).join(""));
  return { refreshed, corrected, requests: records.length };
}

if (import.meta.main) {
  const [baselineDir, expectedDir] = process.argv.slice(2);
  if (!baselineDir || !expectedDir) {
    console.error("usage: bun scripts/cutover/refresh-goldens.mjs <baselineDir> <expectedDir>");
    process.exit(2);
  }
  const result = refreshGoldens({ baselineDir: path.resolve(baselineDir), expectedDir: path.resolve(expectedDir) });
  console.log(`refreshed ${result.refreshed.length} from ${baselineDir}, corrected ${result.corrected.length} in place, ${result.requests} upstream requests`);
  console.log(`corrected: ${result.corrected.join(" ")}`);
}
