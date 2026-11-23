import fs from "node:fs";
import path from "node:path";
import { SignJWT } from "jose";
import { PARITY, cliToken, lanAddress } from "./config.js";
import { startMockUpstream } from "./mock-upstream.js";
import { UPSTREAM_INDEX } from "./compare-upstream.mjs";
import { shapeFrame, summarizeBody, normalizeBody, normalizeHeaders, normalizeSse, maskRetryAfter, maskString } from "./normalize.js";

const FIXTURE_DIR = new URL("./fixtures/", import.meta.url);
const MAX_BODY_CHARS = 16384;
const DEFAULT_SSE = { maxFrames: 200, maxMs: 5000 };
const RESET_PATTERN = /ECONNRESET|ConnectionClosed|connection (was )?closed|socket|terminated|aborted|UND_ERR/i;

export const fixtureFileNames = () => fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json") && f !== "seed.json" && f !== "coverage.json").sort();

export function loadFixtures(only) {
  return fixtureFileNames()
    .map((f) => JSON.parse(fs.readFileSync(new URL(f, FIXTURE_DIR), "utf8")))
    .filter((fx) => !only || fx.id.startsWith(only));
}

export function classifyBodyError(e) {
  return RESET_PATTERN.test(`${e?.code ?? ""} ${e?.message ?? e}`) ? "connection-reset" : "body-read-failed";
}

async function sessionCookie() {
  const jwt = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(new TextEncoder().encode(PARITY.jwtSecret));
  return `auth_token=${jwt}`;
}

async function readFrames(res, { maxFrames, maxMs }) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let error;
  const deadline = Date.now() + maxMs;
  let timer;
  try {
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      const next = await Promise.race([
        reader.read(),
        new Promise((r) => {
          timer = setTimeout(() => r(null), left);
        }),
      ]);
      clearTimeout(timer);
      if (!next || next.done) break;
      text += decoder.decode(next.value, { stream: true });
      if (normalizeSse(text).length >= maxFrames) break;
    }
  } catch (e) {
    error = e;
  } finally {
    clearTimeout(timer);
    reader.cancel().catch(() => {});
  }
  return { text, error };
}

async function readText(res) {
  try {
    return { text: await res.text() };
  } catch (error) {
    return { text: "", error };
  }
}

export async function record({ baseUrl, outDir, mock, only, dataDir, fixtures = loadFixtures(only), log = () => {} }) {
  fs.mkdirSync(outDir, { recursive: true });
  const lan = lanAddress();
  const cookie = await sessionCookie();
  const token = cliToken();
  const replacements = [
    [new URL(baseUrl).host, "<BASE_HOST>"],
    [mock.url.replace("http://", ""), "<UPSTREAM_HOST>"],
    ...(lan ? [[lan, "<LAN>"]] : []),
    ...(dataDir ? [[JSON.stringify(dataDir).slice(1, -1), "<DATA_DIR>"], [dataDir, "<DATA_DIR>"]] : []),
  ];
  const mask = (text) => replacements.reduce((s, [from, to]) => s.replaceAll(from, to), text).replace(/<DATA_DIR>[^"\s]*/g, (m) => m.replaceAll("\\\\", "/"));
  const subst = (s) => s.replaceAll("__UPSTREAM__", mock.url).replaceAll("__API_KEY__", PARITY.apiKey).replaceAll("__PASSWORD__", PARITY.password);

  const results = [];
  const unreachable = [];
  const upstreamIndex = [];
  for (const fx of fixtures) {
    if (fx.peer === "lan" && !lan) {
      log(`skip ${fx.id}: no non-internal IPv4`);
      continue;
    }
    const origin = fx.peer === "lan" ? `http://${lan}:${new URL(baseUrl).port}` : baseUrl;
    const headers = { ...(fx.headers ?? {}) };
    for (const k of Object.keys(headers)) headers[k] = subst(headers[k]);
    if (fx.peer === "proxied") {
      headers["x-forwarded-for"] = PARITY.proxiedIp;
      headers["x-forwarded-proto"] = "https";
    }
    if (fx.auth === "cli") headers["x-9r-cli-token"] = token;
    if (fx.auth === "apikey") headers.authorization = `Bearer ${PARITY.apiKey}`;
    if (fx.auth === "session") headers.cookie = cookie;

    let body;
    if (fx.json !== undefined) {
      body = subst(JSON.stringify(fx.json));
      headers["content-type"] ??= "application/json";
    } else if (fx.body !== undefined) body = subst(fx.body);

    if (fx.waitMs) await Bun.sleep(fx.waitMs);
    const before = mock.requests.length;
    const attempts = fx.repeat?.max ?? 1;
    let res;
    let attempt = 0;
    let frames;
    let text;
    let bodyError;
    const errors = [];
    for (; attempt < attempts; attempt++) {
      try {
        res = await fetch(origin + subst(fx.path), { method: fx.method, headers, body, redirect: "manual" });
      } catch (e) {
        errors.push(String(e?.code ?? e?.message ?? e));
        res = null;
        break;
      }
      const isSse = (res.headers.get("content-type") ?? "").includes("text/event-stream") || fx.sse;
      if (isSse) {
        const read = await readFrames(res, fx.sse ?? DEFAULT_SSE);
        frames = normalizeSse(read.text);
        if (fx.sse?.shape) frames = frames.map(shapeFrame);
        bodyError = read.error;
      } else {
        const read = await readText(res);
        text = read.text;
        bodyError = read.error;
      }
      if (bodyError) break;
      if (!fx.repeat || res.status === fx.repeat.until) break;
    }

    const out = res
      ? { status: res.status, headers: normalizeHeaders(res.headers, Date.parse(res.headers.get("date") ?? "") || Date.now()) }
      : { status: 0, headers: {}, error: errors[0] };
    if (!res) unreachable.push(fx.id);
    if (res && bodyError) {
      out.error = classifyBodyError(bodyError);
      out.framesSoFar = frames ?? null;
    } else if (res) {
      if (frames) out.frames = frames;
      else if (text !== undefined && text !== "") {
        const ct = res.headers.get("content-type") ?? "";
        let parsed;
        if (ct.includes("json")) {
          try {
            parsed = JSON.parse(text);
          } catch {}
        }
        out.body = parsed !== undefined ? normalizeBody(parsed) : ct.includes("text/html") ? { html: true, title: /<title>([^<]*)<\/title>/.exec(text)?.[1] ?? null } : maskString(text);
        if (JSON.stringify(out.body).length > MAX_BODY_CHARS) out.body = summarizeBody(out.body);
      }
      if (fx.repeat) out.attempts = attempt + 1;
    }
    upstreamIndex.push({ id: fx.id, from: before, to: mock.requests.length });
    out.upstream = mock.requests.slice(before).map((r) => {
      let b = r.body;
      try {
        b = normalizeBody(JSON.parse(r.body));
      } catch {}
      return { method: r.method, path: r.path, body: b };
    });

    if (/reset after <N>s/.test(JSON.stringify(out.body ?? "")) && out.headers["retry-after"]) out.headers["retry-after"] = "<N>";
    const final = fx.repeat ? maskRetryAfter(out) : out;
    if (fx.repeat && final.headers["retry-after"]) final.headers["retry-after"] = "<N>";
    fs.writeFileSync(path.join(outDir, `${fx.id}.json`), mask(JSON.stringify(final, null, 2)) + "\n");
    results.push(fx.id);
  }
  fs.writeFileSync(path.join(outDir, UPSTREAM_INDEX), upstreamIndex.map((e) => `${JSON.stringify(e)}\n`).join(""));
  return { ids: results, unreachable };
}

if (import.meta.main) {
  const [baseUrl, outDir] = process.argv.slice(2);
  if (!baseUrl || !outDir) {
    console.error("usage: bun tests/parity/record.mjs <baseUrl> <outDir> [--only <prefix>]");
    process.exit(2);
  }
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
  const mock = await startMockUpstream({ port: PARITY.mockPort, outDir });
  try {
    const { ids, unreachable } = await record({ baseUrl, outDir, mock, only, log: console.error });
    console.log(`recorded ${ids.length} fixtures into ${outDir}`);
    if (unreachable.length) console.error(`${unreachable.length} fixtures got no response: ${unreachable.join(", ")}`);
  } finally {
    await mock.stop();
  }
}
