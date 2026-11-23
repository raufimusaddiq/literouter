import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { buildWeb } = await import("../../src/web/build.js");
const { routes } = await import("../../src/web/routes.js");

const BUDGET_BYTES = 650 * 1024;
const HEAVY = ["node_modules/recharts", "node_modules/@xyflow", "node_modules/@dnd-kit"];
let outdir;
let outputs;
let initial;
let devOutdir;

function norm(key) {
  return key.split("\\").join("/");
}

function inputKeys(key) {
  return Object.keys(outputs[key]?.inputs ?? {}).map(norm);
}

function reachInitial(metafile) {
  const entries = Object.entries(metafile.outputs)
    .filter(([, output]) => output.entryPoint && norm(output.entryPoint).endsWith("web/index.html"))
    .map(([key]) => key);
  expect(entries.some((key) => key.endsWith(".js"))).toBe(true);
  expect(entries.some((key) => key.endsWith(".css"))).toBe(true);
  const reached = new Set();
  const queue = [...entries];
  while (queue.length) {
    const key = queue.pop();
    if (reached.has(key)) continue;
    reached.add(key);
    for (const edge of metafile.outputs[key]?.imports ?? []) {
      if (edge.kind === "import-statement" || edge.kind === "script-tag") queue.push(edge.path);
    }
  }
  return reached;
}

function readOutput(key) {
  return fs.readFileSync(path.join(outdir, norm(key).replace(/^.*?(index\.html|assets\/.*)$/, "$1")), "utf8");
}

function initialJs() {
  return [...initial].filter((key) => key.endsWith(".js"));
}

function lazy() {
  return Object.keys(outputs).filter((key) => !initial.has(key));
}

beforeAll(async () => {
  outdir = fs.mkdtempSync(path.join(os.tmpdir(), "lr-web-build-"));
  const result = await buildWeb({ production: true, outdir });
  outputs = result.metafile.outputs;
  initial = reachInitial(result.metafile);
}, 120_000);

afterAll(() => {
  if (outdir) fs.rmSync(outdir, { recursive: true, force: true });
  if (devOutdir) fs.rmSync(devOutdir, { recursive: true, force: true });
});

function jsFilesIn(dir) {
  return fs
    .readdirSync(path.join(dir, "assets"))
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(dir, "assets", name));
}

function entryJs(metafile) {
  const key = Object.entries(metafile.outputs).find(
    ([name, output]) => output.entryPoint && norm(output.entryPoint).endsWith("web/index.html") && name.endsWith(".js"),
  )[0];
  return `assets/${path.basename(norm(key))}`;
}

function evalWithoutProcess(dir, entry) {
  const run = Bun.spawnSync({
    cmd: [process.execPath, path.join(import.meta.dir, "fixtures", "eval-without-process.mjs"), dir, entry],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NODE_ENV: "test" },
  });
  const out = run.stdout.toString();
  const line = out.split(/\r?\n/).find((text) => text.startsWith("RESULT "));
  if (!line) throw new Error(["no RESULT line", `stdout: ${out}`, `stderr: ${run.stderr.toString()}`].join("\n"));
  return JSON.parse(line.slice("RESULT ".length));
}

describe("web build", () => {
  it("production output contains no process.env access", () => {
    const offenders = jsFilesIn(outdir).filter((file) => fs.readFileSync(file, "utf8").includes("process.env"));
    expect(offenders.map((file) => path.basename(file))).toEqual([]);
  });

  it("production entry chunk graph evaluates without a process global", () => {
    const entry = entryJs({ outputs });
    expect(evalWithoutProcess(outdir, entry)).toEqual({ processHidden: true, ok: true });
  }, 60_000);

  it("dev build contains no process.env access and evaluates without a process global", async () => {
    devOutdir = fs.mkdtempSync(path.join(os.tmpdir(), "lr-web-build-dev-"));
    const result = await buildWeb({ production: false, outdir: devOutdir });
    const offenders = jsFilesIn(devOutdir).filter((file) => fs.readFileSync(file, "utf8").includes("process.env"));
    expect(offenders.map((file) => path.basename(file))).toEqual([]);
    expect(evalWithoutProcess(devOutdir, entryJs(result.metafile))).toEqual({ processHidden: true, ok: true });
  }, 120_000);

  it("index.html uses absolute asset URLs", () => {
    const html = fs.readFileSync(path.join(outdir, "index.html"), "utf8");
    expect(html).toMatch(/src="\/assets\/index-[^"]+\.js"/);
    expect(html).not.toContain('"./assets');
  });

  it("no React development build", () => {
    for (const key of initialJs()) {
      const code = readOutput(key);
      expect(code).not.toContain("jsxDEV");
      expect(code).not.toContain("Download the React DevTools");
    }
  });

  it("initial chunks exclude recharts, @xyflow and @dnd-kit", () => {
    for (const key of initialJs()) {
      for (const needle of HEAVY) {
        expect(inputKeys(key).some((input) => input.includes(needle))).toBe(false);
      }
    }
  });

  it("heavy libraries are in lazy chunks", () => {
    for (const needle of HEAVY) {
      expect(lazy().some((key) => inputKeys(key).some((input) => input.includes(needle)))).toBe(true);
    }
  });

  it("every page is its own lazy chunk", () => {
    for (const route of routes.filter((entry) => !entry.redirect)) {
      const file = norm(route.load.toString().match(/import\("\.\/(pages\/[^"]+)"\)/)[1]);
      const owned = lazy().some((key) => inputKeys(key).some((input) => input.endsWith(`src/web/${file}`)));
      expect({ route: route.path, owned }).toEqual({ route: route.path, owned: true });
    }
  });

  it("initial JS stays under 650 KB", () => {
    const total = initialJs().reduce((sum, key) => sum + outputs[key].bytes, 0);
    console.log(`initial JS bytes: ${total}`);
    expect(total).toBeLessThan(BUDGET_BYTES);
  });

  it("fonts and variables", () => {
    const cssKey = [...initial].find((key) => key.endsWith(".css"));
    expect(cssKey).toBeDefined();
    const css = readOutput(cssKey);
    expect(css).toContain("@font-face");
    expect(css).toContain("IBM Plex Sans Variable");
    expect(css).toContain("JetBrains Mono Variable");
    expect(css).toContain("--font-plex");
    expect(css).toContain("--font-jetbrains");
  });

  it("material symbols font is emitted", () => {
    const assets = fs.readdirSync(path.join(outdir, "assets"));
    expect(assets.some((name) => /^material-symbols-outlined-.*\.woff2$/.test(name))).toBe(true);
  });

  it("bundle has no next/ module", () => {
    const offenders = [];
    for (const key of Object.keys(outputs)) {
      for (const input of inputKeys(key)) {
        if (/(^|\/)node_modules\/next\//.test(input)) offenders.push(input);
      }
    }
    expect(offenders).toEqual([]);
  });
});
