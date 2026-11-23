import fs from "node:fs";
import path from "node:path";
import { SignJWT } from "jose";
import { PARITY, cliToken, lanAddress } from "./config.js";
import { startMockUpstream } from "./mock-upstream.js";
import { shapeFrame, summarizeBody, normalizeBody, normalizeHeaders, normalizeSse, maskRetryAfter, maskString } from "./normalize.js";

const FIXTURE_DIR = new URL("./fixtures/", import.meta.url);
const MAX_BODY_CHARS = 16384;
const DEFAULT_SSE = { maxFrames: 200, maxMs: 5000 };

export function loadFixtures(only) {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json") && f !== "seed.json" && f !== "coverage.json")
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(new URL(f, FIXTURE_DIR), "utf8")))
    .filter((fx) => !only || fx.id.startsWith(only));
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
  } finally {
    clearTimeout(timer);
    reader.cancel().catch(() => {});
  }
  return text;
}

export async function record({ baseUrl, outDir, mock, only, dataDir, log = () => {} }) {
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
  const mask = (text) => replacements.reduce((s, [from, to]) => s.replaceAll(from, to), text);
  const subst = (s) => s.replaceAll("__UPSTREAM__", mock.url).replaceAll("__API_KEY__", PARITY.apiKey).replaceAll("__PASSWORD__", PARITY.password);

  const results = [];
  for (const fx of loadFixtures(only)) {
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
        frames = normalizeSse(await readFrames(res, fx.sse ?? DEFAULT_SSE));
        if (fx.sse?.shape) frames = frames.map(shapeFrame);
      } else {
        text = await res.text();
      }
      if (!fx.repeat || res.status === fx.repeat.until) break;
    }

    const out = res
      ? { status: res.status, headers: normalizeHeaders(res.headers) }
      : { status: 0, headers: {}, error: errors[0] };
    if (res) {
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
    out.upstream = mock.requests.slice(before).map((r) => {
      let b = r.body;
      try {
        b = normalizeBody(JSON.parse(r.body));
      } catch {}
      return { method: r.method, path: r.path, body: b };
    });

    if (/reset after <N>s/.test(JSON.stringify(out.body ?? "")) && out.headers["retry-after"]) out.headers["retry-after"] = "<N>";
    let json = JSON.stringify(fx.repeat ? maskRetryAfter(out) : out, null, 2);
    if (fx.repeat && out.headers["retry-after"]) json = json.replace(`"retry-after": "${out.headers["retry-after"]}"`, '"retry-after": "<N>"');
    fs.writeFileSync(path.join(outDir, `${fx.id}.json`), mask(json) + "\n");
    results.push(fx.id);
  }
  return results;
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
    const ids = await record({ baseUrl, outDir, mock, only, log: console.error });
    console.log(`recorded ${ids.length} fixtures into ${outDir}`);
  } finally {
    await mock.stop();
  }
}
