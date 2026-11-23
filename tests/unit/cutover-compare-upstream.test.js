import { describe, test, expect, afterEach, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compareUpstream, upstreamDiffs } from "../parity/compare-upstream.mjs";

const script = path.resolve(import.meta.dir, "../parity/compare-upstream.mjs");
const record = (body, headers = [["content-type", "application/json"]], seq = 0) => ({
  seq,
  method: "POST",
  path: "/v1/messages",
  headers,
  bodyBase64: Buffer.from(body).toString("base64"),
});

const cleanup = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()();
});
const writeRun = (records) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cutover-up-"));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "upstream-requests.jsonl"), records.map((r) => `${JSON.stringify(r)}\n`).join(""));
  fs.writeFileSync(path.join(dir, "upstream-fixtures.jsonl"), `${JSON.stringify({ id: "f", from: 0, to: records.length })}\n`);
  return dir;
};
const noKnownDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutover-known-"));
const noKnown = path.join(noKnownDir, "none.json");
fs.writeFileSync(noKnown, "[]");
afterAll(() => fs.rmSync(noKnownDir, { recursive: true, force: true }));
const cli = (expected, actual) => Bun.spawnSync([process.execPath, script, expected, actual, "--known", noKnown]);

const ephemeral = (ttl) => `{"cache_control":{"type":"ephemeral","ttl":"${ttl}"}}`;

describe("cutover compare-upstream", () => {
  test("identical bodies and headers pass", () => {
    const r = record(ephemeral("1h"), [["anthropic-beta", "x"], ["content-length", "43"]]);
    expect(compareUpstream([r], [{ ...r }])).toEqual([]);
    expect(cli(writeRun([r]), writeRun([r])).exitCode).toBe(0);
  });

  test("a one-byte body difference fails", () => {
    const a = record(ephemeral("1h"));
    const b = record(ephemeral("5m"));
    expect(compareUpstream([a], [b])).toHaveLength(1);
    expect(compareUpstream([a], [b])[0]).toContain("body differs");
    const out = cli(writeRun([a]), writeRun([b]));
    expect(out.exitCode).toBe(1);
    expect(out.stderr.toString()).toContain("body differs");
  });

  test("key order in the body is a difference", () => {
    const a = record('{"a":1,"b":2}');
    const b = record('{"b":2,"a":1}');
    expect(JSON.parse(Buffer.from(a.bodyBase64, "base64"))).toEqual(JSON.parse(Buffer.from(b.bodyBase64, "base64")));
    expect(compareUpstream([a], [b])).toHaveLength(1);
  });

  test("allowlisted user-agent difference is ignored", () => {
    const a = record("{}", [["user-agent", "node"]]);
    const b = record("{}", [["user-agent", "Bun/1.4.4"]]);
    expect(compareUpstream([a], [b], [{ header: "user-agent", reason: "runtime identity" }])).toEqual([]);
    expect(compareUpstream([a], [b])).toHaveLength(1);
  });

  test("unlisted anthropic-beta difference fails", () => {
    const a = record("{}", [["anthropic-beta", "a"], ["user-agent", "node"]]);
    const b = record("{}", [["anthropic-beta", "b"], ["user-agent", "Bun"]]);
    const diffs = compareUpstream([a], [b], [{ header: "user-agent", reason: "runtime identity" }]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain("anthropic-beta");
    expect(upstreamDiffs([a], [b], [])[0].path).toBe("[0].header.anthropic-beta");
  });

  test("extra or missing upstream request fails", () => {
    const one = record("{}");
    const two = record("{}", undefined, 1);
    expect(compareUpstream([one], [one, two])[0]).toContain("request count");
    expect(compareUpstream([one, two], [one])[0]).toContain("request count");
    expect(cli(writeRun([one]), writeRun([one, two])).exitCode).toBe(1);
  });

  test("header order alone is not a difference", () => {
    const a = record("{}", [["a", "1"], ["b", "2"]]);
    const b = record("{}", [["b", "2"], ["a", "1"]]);
    expect(compareUpstream([a], [b])).toEqual([]);
  });

  test("header names compare lower-cased and content-length is a header", () => {
    const a = record("{}", [["Content-Length", "2"]]);
    expect(compareUpstream([a], [record("{}", [["content-length", "2"]])])).toEqual([]);
    expect(compareUpstream([a], [record("{}", [["content-length", "3"]])])[0]).toContain("content-length");
  });
});
