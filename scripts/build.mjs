import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { buildWeb as defaultBuildWeb } from "../src/web/build.js";
import { writeProviderIconManifest } from "./gen-provider-icon-manifest.mjs";

const repoRoot = resolve(dirname(import.meta.dir));

export const COMPILE_TARGETS = ["bun-linux-x64-musl", "bun-linux-arm64-musl"];

const SERVER_NAMING = {
  entry: "[name].[ext]",
  chunk: "[name]-[hash].[ext]",
  asset: "[name]-[hash].[ext]",
};

function absolute(root, path) {
  return isAbsolute(path) ? path : resolve(root, path);
}

function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [relative(base, full).split("\\").join("/")];
  });
}

function serverBuildOptions({ root, entry }) {
  return {
    entrypoints: [absolute(root, entry)],
    target: "bun",
    root,
    minify: true,
    sourcemap: "none",
    define: { "process.env.LITEROUTER_BUNDLED": '"1"' },
  };
}

function describeLog(log) {
  const where = log.position?.file ? `${log.position.file}:${log.position.line}:${log.position.column}: ` : "";
  return `${where}${log.message ?? String(log)}`;
}

async function runBuild(options) {
  const result = await Bun.build({ ...options, throw: false });
  if (!result.success) {
    throw new Error(`build failed:\n${result.logs.map(describeLog).join("\n")}`);
  }
  return result;
}

function assertRemovable(out, root) {
  const rel = relative(out, root);
  const containsRoot = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  if (containsRoot || out === parse(out).root) {
    throw new Error(`refusing to remove ${out}: the output directory must not be the repo root or one of its parents`);
  }
}

async function buildSpa({ webOutdir, buildWeb }) {
  rmSync(webOutdir, { recursive: true, force: true });
  await buildWeb({ production: true, outdir: webOutdir });
}

export async function buildApp({ root = repoRoot, outdir = "dist/app", entry = "src/server/index.js", buildWeb = defaultBuildWeb } = {}) {
  const out = absolute(root, outdir);
  assertRemovable(out, resolve(root));
  rmSync(out, { recursive: true, force: true });
  writeProviderIconManifest({ root });
  await buildSpa({ webOutdir: join(out, "web"), buildWeb });
  await runBuild({
    ...serverBuildOptions({ root, entry }),
    outdir: out,
    publicPath: "/",
    naming: SERVER_NAMING,
  });
  cpSync(join(root, "public"), join(out, "public"), { recursive: true });
  return { outdir: out, files: listFiles(out) };
}

export function compileOptions({ target, outfile, assets }) {
  return { target, outfile, assets, autoloadBunfig: false, autoloadDotenv: false };
}

export async function compileApp({
  target,
  root = repoRoot,
  outfile = `dist/bin/literouter-${target}`,
  entry = "src/server/index.js",
  buildWeb = defaultBuildWeb,
} = {}) {
  if (!COMPILE_TARGETS.includes(target)) throw new Error(`unsupported compile target: ${target}`);
  const out = absolute(root, outfile);
  const stage = join(root, "dist", "compile-stage");
  writeProviderIconManifest({ root });
  await buildSpa({ webOutdir: join(stage, "web"), buildWeb });
  mkdirSync(dirname(out), { recursive: true });
  await runBuild({
    ...serverBuildOptions({ root, entry }),
    compile: compileOptions({ target, outfile: out, assets: [join(root, "public"), join(stage, "web")] }),
  });
  rmSync(stage, { recursive: true, force: true });
  return out;
}

export const USAGE = [
  "usage: bun scripts/build.mjs [--outdir <dir>]",
  "       bun scripts/build.mjs --compile <target> [--outfile <file>]",
  "",
  "  --outdir <dir>     server bundle directory (default dist/app)",
  "  --compile <target> compile a standalone executable instead; targets: " + COMPILE_TARGETS.join(", "),
  "  --outfile <file>   executable path for --compile (default dist/bin/literouter-<target>)",
  "",
  "A relative --outdir or --outfile is resolved against the current working directory.",
].join("\n");

export function parseArgs(argv, cwd = process.cwd()) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`${flag} needs a value`);
    return next;
  };
  const compile = value("--compile");
  const outdir = value("--outdir");
  const outfile = value("--outfile");
  if (compile && outdir) throw new Error("--outdir does not apply to --compile; use --outfile for the executable path");
  if (outfile && !compile) throw new Error("--outfile needs --compile");
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    compile,
    outdir: outdir ? absolute(cwd, outdir) : undefined,
    outfile: outfile ? absolute(cwd, outfile) : undefined,
  };
}

if (import.meta.main) {
  try {
    const { help, compile, outdir, outfile } = parseArgs(process.argv.slice(2));
    if (help) {
      console.log(USAGE);
    } else if (compile) {
      const file = await compileApp({ target: compile, ...(outfile ? { outfile } : {}) });
      console.log(`compiled ${file}`);
    } else {
      const result = await buildApp(outdir ? { outdir } : {});
      console.log(`built ${result.files.length} files into ${result.outdir}`);
    }
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    process.exit(1);
  }
}
