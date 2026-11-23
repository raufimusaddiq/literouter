import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_ROOTS = ["tests", "cli/test"];
export const CORPUS_EXTRA_ROOTS = ["scripts", ".github", "package.json"];
export const EXEMPT_DIRS = ["tests/parity/fixtures", "tests/parity/expected"];

export const DIR_LOADED_ALLOW = [];

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".claude"]);
const TEXT_EXT = new Set([".js", ".mjs", ".cjs", ".json", ".yml", ".yaml", ".sh", ".toml", ".txt", ".snap"]);
const TEST_FILE = /\.test\.(js|mjs)$/;
const ASSERTION = /\bexpect\s*\(|\bexpect\.(assertions|hasAssertions)\b|\bassert(\.|\()|\.toMatchSnapshot\(|\bt\.(is|true|deepEqual)\b/;

function walk(root, rel, out) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return;
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    out.push(rel.split(path.sep).join("/"));
    return;
  }
  for (const name of fs.readdirSync(full).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    walk(root, path.join(rel, name), out);
  }
}

function under(file, dir) {
  return file === dir || file.startsWith(dir.endsWith("/") ? dir : `${dir}/`);
}

function read(root, file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function isText(file) {
  return TEXT_EXT.has(path.extname(file));
}

function stem(file) {
  return path.basename(file, path.extname(file));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TITLE = /^(\s*)(describe|it|test)(\.\w+)*\s*\(\s*(["'`])((?:\\.|(?!\4).)*)\4/;

export function duplicateTitles(source) {
  const seen = new Map();
  const stack = [];
  const dups = [];
  for (const line of source.split("\n")) {
    const m = TITLE.exec(line);
    if (!m) continue;
    const [, indent, kind, modifier, , title] = m;
    if (modifier === ".each" || title.includes("${")) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent.length) stack.pop();
    if (kind === "describe") {
      stack.push({ indent: indent.length, title });
      continue;
    }
    const key = [...stack.map((s) => s.title), title].join(" > ");
    if (seen.has(key)) dups.push(key);
    else seen.set(key, true);
  }
  return dups;
}

export function findHygieneProblems(root, { allow = DIR_LOADED_ALLOW } = {}) {
  const files = [];
  for (const dir of TEST_ROOTS) walk(root, dir, files);
  const inScope = files.filter((f) => !EXEMPT_DIRS.some((d) => under(f, d)));
  const extra = [];
  for (const dir of CORPUS_EXTRA_ROOTS) walk(root, dir, extra);
  const corpus = new Map();
  for (const f of [...inScope, ...extra]) {
    if (!isText(f) || f === "scripts/check-test-hygiene.mjs") continue;
    corpus.set(f, read(root, f));
  }
  for (const f of files) {
    if (EXEMPT_DIRS.some((d) => under(f, d)) && isText(f)) corpus.set(f, read(root, f));
  }

  const problems = [];
  const allowed = (f) => allow.some((a) => under(f, a.path));
  const mentionedElsewhere = (self, needle) => {
    for (const [f, text] of corpus) if (f !== self && text.includes(needle)) return true;
    return false;
  };

  for (const f of inScope) {
    const isFixture = /(^|\/)(fixtures|__fixtures__)\//.test(f);
    const isHelper = !isFixture && /(^|\/)helpers\//.test(f) && !TEST_FILE.test(f);
    if (isFixture && !TEST_FILE.test(f) && !/(^|\/)(AGENTS|README)\.md$/.test(f) && !allowed(f)) {
      if (!mentionedElsewhere(f, path.basename(f))) {
        problems.push({ rule: "unreferenced-fixture", file: f });
      }
    }
    if (isHelper && /\.(js|mjs)$/.test(f)) {
      const name = stem(f);
      const spec = new RegExp(`["'\`](?:[^"'\`\\n]*/)?${escapeRe(name)}(?:\\.[cm]?js)?["'\`]`);
      let used = false;
      for (const [other, text] of corpus) {
        if (other !== f && spec.test(text)) {
          used = true;
          break;
        }
      }
      if (!used) problems.push({ rule: "unreferenced-helper", file: f });
    }
    if (TEST_FILE.test(f) && !isFixture) {
      const text = read(root, f);
      if (!ASSERTION.test(text)) problems.push({ rule: "no-assertions", file: f });
      for (const title of duplicateTitles(text)) {
        problems.push({ rule: "duplicate-title", file: f, detail: title });
      }
    }
  }
  return problems;
}

function main() {
  if (process.argv[2] !== "--check") {
    console.error("Usage: check-test-hygiene.mjs --check");
    process.exit(2);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const problems = findHygieneProblems(root);
  for (const p of problems) {
    console.error(`${p.rule}: ${p.file}${p.detail ? ` :: ${p.detail}` : ""}`);
  }
  if (problems.length) {
    console.error(`${problems.length} test hygiene problem(s). See CLAUDE.md "Tests stay lean".`);
    process.exit(1);
  }
  console.log("test hygiene ok");
}

if (import.meta.main) main();
