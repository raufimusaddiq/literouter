#!/usr/bin/env bun
// Re-runnable vitest -> bun:test codemod. Keep until cutover: every main -> staging
// merge brings vitest-style tests and the merge procedure re-runs this script.
//
//   bun scripts/migrate-vitest-to-bun.mjs [--check] [paths...]
//
// Pure API: transform(source, filePath) -> string; analyze() also returns manual-review items.
import fs from "node:fs";
import path from "node:path";

const TYPE_ONLY = new Set(["Mock", "MockInstance", "MockedFunction", "Mocked", "SpyInstance"]);
const SKIP_DIRS = new Set(["node_modules", ".claude", "dist", ".git"]);

// Returns a same-length copy of src with comments and string/template-literal text blanked
// (newlines kept) so regexes only see real code. `${}` expressions stay visible.
function maskSource(src) {
  const out = src.split("");
  const blank = (i) => {
    if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
  };
  const stack = []; // open template expressions, each tracking brace depth
  let i = 0;
  let inTemplate = false;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (inTemplate) {
      if (c === "\\") { blank(i); blank(i + 1); i += 2; continue; }
      if (c === "`") { blank(i); inTemplate = false; i++; continue; }
      if (c === "$" && src[i + 1] === "{") {
        blank(i);
        blank(i + 1);
        stack.push({ depth: 1 });
        inTemplate = false;
        i += 2;
        continue;
      }
      blank(i); i++; continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") { blank(i); i++; }
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      blank(i); blank(i + 1); i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { blank(i); i++; }
      if (i < n) { blank(i); blank(i + 1); i += 2; }
      continue;
    }
    if (c === '"' || c === "'") {
      blank(i); i++;
      while (i < n && src[i] !== c && src[i] !== "\n") {
        if (src[i] === "\\") { blank(i); i++; }
        blank(i); i++;
      }
      if (i < n && src[i] === c) { blank(i); i++; }
      continue;
    }
    if (c === "`") { blank(i); inTemplate = true; i++; continue; }
    if (stack.length) {
      const top = stack[stack.length - 1];
      if (c === "{") top.depth++;
      else if (c === "}") {
        top.depth--;
        if (top.depth === 0) { stack.pop(); blank(i); inTemplate = true; i++; continue; }
      }
    }
    i++;
  }
  return out.join("");
}

function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

function parseNames(body) {
  return body
    .split(",")
    .map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim())
    .filter(Boolean);
}

function baseName(spec) {
  return spec.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
}

export function analyze(source, filePath = "") {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const mask = maskSource(source);
  const manual = [];
  const edits = []; // {start,end,text}
  const report = (idx, kind) => manual.push({ file: filePath, line: lineOf(source, idx), kind });
  const hasViImport = /(^|\n)[ \t]*import\s*\{\s*vi\s*\}\s*from\s*["']#test\/vi["']/.test(source);
  let viImported = false;

  // 1. named vitest imports (anchored at line start, real code only)
  const importRe = /^import\s*\{([^}]*)\}\s*from\s*(["'])vitest\2[ \t]*;?/gm;
  for (const m of source.matchAll(importRe)) {
    if (mask[m.index] !== "i") continue;
    const names = parseNames(m[1]);
    const keep = [];
    let hasVi = false;
    for (const spec of names) {
      const b = baseName(spec);
      if (spec.startsWith("type ") || TYPE_ONLY.has(b)) continue;
      if (b === "expectTypeOf" || b === "assertType") report(m.index, `unsupported-type-helper:${b}`);
      if (spec === "vi") hasVi = true;
      else keep.push(spec);
    }
    const lines = [];
    if (keep.length) lines.push(`import { ${keep.join(", ")} } from "bun:test";`);
    if (hasVi && !hasViImport && !viImported) {
      lines.push(`import { vi } from "#test/vi";`);
      viImported = true;
    }
    let end = m.index + m[0].length;
    if (!lines.length) {
      if (source.startsWith("\r\n", end)) end += 2;
      else if (source[end] === "\n") end += 1;
    }
    edits.push({ start: m.index, end, text: lines.join(eol) });
  }

  // other vitest import shapes: report, never silently skip
  const otherRes = [
    /\bimport\s+[\w$*][^;\n"']*\bfrom\s*(["'])vitest(?:\/[^"']*)?\1/g,
    /\bimport\s*\(\s*(["'])vitest(?:\/[^"']*)?\1\s*\)/g,
    /\brequire\s*\(\s*(["'])vitest(?:\/[^"']*)?\1\s*\)/g,
    /^import\s*(["'])vitest\1/gm,
    /^import\s*\{[^}]*\}\s*from\s*(["'])vitest\/[^"']*\1/gm,
  ];
  for (const re of otherRes) {
    for (const m of source.matchAll(re)) {
      // inside a comment/string the leading keyword is blanked in the mask
      if (mask[m.index] !== source[m.index]) continue;
      report(m.index, "unsupported-vitest-import");
    }
  }

  // 2/3. code rewrites + 4. manual-review reports, on masked text
  for (const m of mask.matchAll(/\bvi\.doMock(?=\s*\()/g)) {
    edits.push({ start: m.index + 3, end: m.index + 9, text: "mock" });
  }
  for (const m of mask.matchAll(/\b(?:it|test)(?:\.\w+)*\.fails(?=\s*\()/g)) {
    const s = m.index + m[0].length - "fails".length;
    edits.push({ start: s, end: s + 5, text: "failing" });
  }
  for (const m of mask.matchAll(/\bvi\.importActual\b/g)) report(m.index, "importActual");
  for (const m of mask.matchAll(/\bvi\.doUnmock\b/g)) report(m.index, "doUnmock");
  for (const m of mask.matchAll(/\bimportOriginal\b/g)) report(m.index, "importOriginal");
  for (const m of mask.matchAll(/\b(expectTypeOf|assertType)\s*[(<]/g)) {
    report(m.index, `unsupported-type-helper:${m[1]}`);
  }
  manual.sort((a, b) => a.line - b.line);

  // 5. vitest globals: file uses `vi.` but never imports it
  const usesVi = /(?<![\w$.])vi\.[A-Za-z_]/.test(mask);
  const declaresVi = /\b(?:const|let|var|function)\s+vi\b/.test(mask);
  if (usesVi && !declaresVi && !hasViImport && !viImported) {
    const first = mask.search(/\S/);
    let at = first === -1 ? source.length : first;
    while (at > 0 && source[at - 1] !== "\n") at--;
    edits.push({ start: at, end: at, text: `import { vi } from "#test/vi";${eol}` });
  }

  edits.sort((a, b) => b.start - a.start);
  let out = source;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { output: out, manual };
}

export function transform(source, filePath = "") {
  return analyze(source, filePath).output;
}

function walk(p, acc) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(p)) {
      if (SKIP_DIRS.has(name)) continue;
      walk(path.join(p, name), acc);
    }
  } else if (p.endsWith(".test.js")) acc.push(p);
  return acc;
}

function main(argv) {
  const check = argv.includes("--check");
  const roots = argv.filter((a) => !a.startsWith("--"));
  if (!roots.length) roots.push("tests");
  const files = roots.flatMap((r) => walk(r, []));
  const changed = [];
  const manual = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const { output, manual: items } = analyze(src, f);
    for (const it of items) manual.push(it);
    if (output !== src) {
      changed.push(f);
      if (!check) fs.writeFileSync(f, output);
    }
  }
  for (const m of manual) console.error(`${m.file}:${m.line}: ${m.kind}`);
  const verb = check ? "would change" : "changed";
  console.log(`${files.length} files scanned, ${changed.length} ${verb}, ${manual.length} manual-review items`);
  if (check && changed.length) {
    for (const f of changed) console.log(`  needs conversion: ${f}`);
    process.exit(1);
  }
}

if (import.meta.main) main(process.argv.slice(2));
