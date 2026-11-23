import { readdirSync, rmSync, watch } from "node:fs";
import { join } from "node:path";
import { buildWeb } from "../web/build.js";
import { REPO_ROOT, SPA_DIR, SPA_DIR_OVERRIDE } from "./paths.js";

const MISSING_CODE = "SPA_MISSING";
const WATCHED = ["src", "open-sse"];
const DEV_ROOT = join(REPO_ROOT, "dist", "web-dev");
const DEV_OUTDIR = join(DEV_ROOT, String(process.pid));
const EXIT_CLEANUP_FLAG = "__lrSpaExitCleanup";
const MISSING_BODY = "The dashboard is not built: run bun run build:web.";

let pending = null;
let buildTail = Promise.resolve();
let watchersStarted = false;

function missingError() {
  const message = SPA_DIR_OVERRIDE
    ? `${SPA_DIR} has no index.html`
    : "dist/web is missing: run bun run build:web";
  return Object.assign(new Error(message), { code: MISSING_CODE });
}

async function readBuilt(dir) {
  const file = Bun.file(join(dir, "index.html"));
  if (!(await file.exists())) throw missingError();
  return { dir, indexHtml: await file.text() };
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

export function pruneStaleDevBuilds(root = DEV_ROOT, { alive = isAlive, remove = rmSync } = {}) {
  let names;
  try {
    names = readdirSync(root);
  } catch {
    return;
  }
  for (const name of names) {
    if (!/^\d+$/.test(name) || alive(Number(name))) continue;
    try {
      remove(join(root, name), { recursive: true, force: true });
    } catch (error) {
      console.error("[spa] could not remove stale dev build", name, error?.code ?? error);
    }
  }
}

export function startWatchers() {
  if (watchersStarted) return;
  pruneStaleDevBuilds();
  globalThis.__lrSpaWatchers?.forEach((watcher) => watcher.close());
  globalThis.__lrSpaWatchers = WATCHED.map((name) => {
    const watcher = watch(join(REPO_ROOT, name), { recursive: true }, () => invalidateSpa());
    watcher.unref?.();
    return watcher;
  });
  watchersStarted = true;
  if (globalThis[EXIT_CLEANUP_FLAG]) return;
  globalThis[EXIT_CLEANUP_FLAG] = true;
  process.once("exit", () => {
    try {
      rmSync(DEV_OUTDIR, { recursive: true, force: true });
    } catch {
      return;
    }
  });
}

function devBuild() {
  startWatchers();
  const run = buildTail.then(async () => {
    const { outdir } = await buildWeb({ production: false, outdir: DEV_OUTDIR });
    return readBuilt(outdir);
  });
  buildTail = run.catch(() => {});
  return run;
}

function resolveSpa() {
  if (SPA_DIR_OVERRIDE) return readBuilt(SPA_DIR_OVERRIDE);
  if (process.env.NODE_ENV === "production") return readBuilt(SPA_DIR);
  return devBuild();
}

export function getSpa() {
  if (pending) return pending;
  const attempt = resolveSpa();
  pending = attempt;
  attempt.catch(() => {
    if (pending === attempt) pending = null;
  });
  return attempt;
}

export function invalidateSpa() {
  pending = null;
}

export function spaUnavailableResponse(error) {
  console.error("[spa] dashboard build unavailable:", error?.code === MISSING_CODE ? error.message : error);
  const body = error?.code === MISSING_CODE
    ? MISSING_BODY
    : "The dashboard build failed; see the server log.";
  return new Response(body, {
    status: 500,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
