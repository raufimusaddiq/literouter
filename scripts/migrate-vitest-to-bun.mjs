#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";

const TYPE_ONLY = new Set(["Mock", "MockInstance", "MockedFunction", "Mocked", "SpyInstance"]);
const SKIP_DIRS = new Set(["node_modules", ".claude", "dist", ".git"]);

function maskSource(src) {
  const out = src.split("");
  const blank = (i) => {
    if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
  };
  const stack = [];
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

function chainRoot(mask, dotIdx) {
  let i = dotIdx - 1;
  while (i >= 0) {
    const c = mask[i];
    if (c === ")" || c === "]") {
      const open = c === ")" ? "(" : "[";
      let depth = 0;
      for (; i >= 0; i--) {
        if (mask[i] === c) depth++;
        else if (mask[i] === open && --depth === 0) break;
      }
      i--;
    } else if (/[\w$.\s]/.test(c)) i--;
    else break;
  }
  const m = /^[\w$]+/.exec(mask.slice(i + 1, dotIdx).trimStart());
  return m ? m[0] : "";
}

function prologueEnd(source) {
  let pos = 0;
  if (source.startsWith("#!")) {
    const nl = source.indexOf("\n");
    pos = nl === -1 ? source.length : nl + 1;
  }
  const re = /^(?:[ \t]*\r?\n)*[ \t]*(["'])use strict\1[ \t]*;?[ \t]*(?:\r?\n|$)/;
  for (;;) {
    const m = re.exec(source.slice(pos));
    if (!m) break;
    pos += m[0].length;
  }
  return pos;
}

function matchClose(mask, open) {
  const o = mask[open];
  const c = o === "(" ? ")" : o === "[" ? "]" : "}";
  let depth = 0;
  for (let i = open; i < mask.length; i++) {
    if (mask[i] === o) depth++;
    else if (mask[i] === c && --depth === 0) return i;
  }
  return -1;
}

function literalEnd(source, start) {
  const q = source[start];
  let i = start + 1;
  let braces = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") { i += 2; continue; }
    if (q === "`" && c === "$" && source[i + 1] === "{") { braces++; i += 2; continue; }
    if (braces) {
      if (c === "{") braces++;
      else if (c === "}") braces--;
      i++;
      continue;
    }
    if (c === q) return i;
    if (c === "\n" && q !== "`") return -1;
    i++;
  }
  return -1;
}

function eachTitleEdits(source, mask) {
  const edits = [];
  const ws = /\s/;
  for (const m of mask.matchAll(/\.each(?=\s*\()/g)) {
    let i = m.index + 5;
    while (ws.test(mask[i])) i++;
    const tableEnd = matchClose(mask, i);
    if (tableEnd === -1) continue;
    i = tableEnd + 1;
    while (ws.test(mask[i])) i++;
    if (mask[i] !== "(") continue;
    i++;
    for (;;) {
      while (ws.test(source[i])) i++;
      const q = source[i];
      if (q !== '"' && q !== "'" && q !== "`") break;
      const end = literalEnd(source, i);
      if (end === -1) break;
      const body = source.slice(i + 1, end);
      const parts = q === "`" ? body.split(/(\$\{[^}]*\})/) : [body];
      const next = parts
        .map((p) => (p.startsWith("${") ? p : p.replace(/%%|%[so]/g, (x) => (x === "%%" ? x : "%p"))))
        .join("");
      if (next !== body) edits.push({ start: i + 1, end, text: next });
      i = end + 1;
      while (ws.test(source[i])) i++;
      if (source[i] !== "+") break;
      i++;
    }
  }
  return edits;
}

export function analyze(source, filePath = "") {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const mask = maskSource(source);
  const manual = [];
  const edits = [];
  const report = (idx, kind) => manual.push({ file: filePath, line: lineOf(source, idx), kind });
  const hasViImport = /(^|\n)[ \t]*import\s*\{\s*vi(?:\s+as\s+[\w$]+)?\s*\}\s*from\s*["']#test\/vi["']/.test(source);
  let viImported = false;

  const importRe = /^import\s*\{([^}]*)\}\s*from\s*(["'])vitest\2[ \t]*;?/gm;
  for (const m of source.matchAll(importRe)) {
    if (mask[m.index] !== "i") continue;
    const names = parseNames(m[1]);
    const keep = [];
    let hasVi = false;
    let viSpec = "vi";
    for (const spec of names) {
      const b = baseName(spec);
      if (spec.startsWith("type ") || TYPE_ONLY.has(b)) continue;
      if (b === "expectTypeOf" || b === "assertType") report(m.index, `unsupported-type-helper:${b}`);
      if (b === "vi") { hasVi = true; viSpec = spec; }
      else keep.push(spec);
    }
    const lines = [];
    if (keep.length) lines.push(`import { ${keep.join(", ")} } from "bun:test";`);
    if (hasVi && !hasViImport && !viImported) {
      lines.push(`import { ${viSpec} } from "#test/vi";`);
      viImported = true;
    }
    let end = m.index + m[0].length;
    if (!lines.length) {
      if (source.startsWith("\r\n", end)) end += 2;
      else if (source[end] === "\n") end += 1;
    }
    edits.push({ start: m.index, end, text: lines.join(eol) });
  }

  const typeImportRe = /^import\s+type\s*\{[^}]*\}\s*from\s*(["'])vitest\1[ \t]*;?/gm;
  const droppedTypeImports = new Set();
  for (const m of source.matchAll(typeImportRe)) {
    if (mask[m.index] !== "i") continue;
    droppedTypeImports.add(m.index);
    let end = m.index + m[0].length;
    if (source.startsWith("\r\n", end)) end += 2;
    else if (source[end] === "\n") end += 1;
    edits.push({ start: m.index, end, text: "" });
  }

  const otherRes = [
    /\bimport\s+[\w$*][^;\n"']*\bfrom\s*(["'])vitest(?:\/[^"']*)?\1/g,
    /\bimport\s*\(\s*(["'])vitest(?:\/[^"']*)?\1\s*\)/g,
    /\brequire\s*\(\s*(["'])vitest(?:\/[^"']*)?\1\s*\)/g,
    /^import\s*(["'])vitest\1/gm,
    /^import\s*\{[^}]*\}\s*from\s*(["'])vitest\/[^"']*\1/gm,
  ];
  for (const re of otherRes) {
    for (const m of source.matchAll(re)) {
      if (mask[m.index] !== source[m.index]) continue;
      if (droppedTypeImports.has(m.index)) continue;
      report(m.index, "unsupported-vitest-import");
    }
  }

  for (const m of mask.matchAll(/\bvi\.doMock(?=\s*\()/g)) {
    edits.push({ start: m.index + 3, end: m.index + 9, text: "mock" });
  }
  for (const m of mask.matchAll(/\.fails(?=\s*\()/g)) {
    const root = chainRoot(mask, m.index);
    if (root === "it" || root === "test") {
      edits.push({ start: m.index + 1, end: m.index + 6, text: "failing" });
    } else {
      report(m.index, "fails-unrecognised-chain");
    }
  }
  for (const m of mask.matchAll(/\bvi\.importActual\b/g)) report(m.index, "importActual");
  for (const m of mask.matchAll(/\bvi\.doUnmock\b/g)) report(m.index, "doUnmock");
  for (const m of mask.matchAll(/\bimportOriginal\b/g)) report(m.index, "importOriginal");
  for (const m of mask.matchAll(/\b(expectTypeOf|assertType)\s*[(<]/g)) {
    report(m.index, `unsupported-type-helper:${m[1]}`);
  }
  for (const e of eachTitleEdits(source, mask)) edits.push(e);
  manual.sort((a, b) => a.line - b.line);

  const usesVi = /(?<![\w$.])vi\.[A-Za-z_]/.test(mask);
  const declaresVi = /\b(?:const|let|var|function)\s+vi\b/.test(mask);
  if (usesVi && !declaresVi && !hasViImport && !viImported) {
    const first = mask.search(/\S/);
    let at = first === -1 ? source.length : first;
    while (at > 0 && source[at - 1] !== "\n") at--;
    at = Math.max(at, prologueEnd(source));
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

export function convertSnapshot(source) {
  const out = source.replace(
    /^\/\/ Vitest Snapshot v1, [^\r\n]*/,
    "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots",
  );
  const keyed = out.replace(/^exports\[`((?:[^`\\]|\\.)*)`\] = `/gm, (m, key) => {
    return "exports[`" + key.replaceAll(" > ", " ") + "`] = `";
  });
  return reflowMultilineStrings(keyed);
}

function reflowMultilineStrings(text) {
  const lines = text.split("\n");
  const res = [];
  const isEnd = (t) => /"(,?)\r?$/.test(t);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^(\s*"(?:[^"\\]|\\.)*": )"([^\n]*)$/.exec(line);
    if (!m || isEnd(m[2]) || line.startsWith("exports[")) {
      res.push(line);
      continue;
    }
    let j = i + 1;
    while (j < lines.length && !isEnd(lines[j]) && !lines[j].startsWith("exports[")) j++;
    if (j >= lines.length || lines[j].startsWith("exports[")) {
      res.push(line);
      continue;
    }
    const cr = line.endsWith("\r") ? "\r" : "";
    const last = lines[j].replace(/\r$/, "");
    const comma = last.endsWith(",") ? "," : "";
    res.push(m[1] + cr);
    res.push('"' + m[2]);
    for (let k = i + 1; k < j; k++) res.push(lines[k]);
    res.push((comma ? last.slice(0, -1) : last) + cr);
    res.push(comma + cr);
    i = j;
  }
  return res.join("\n");
}

function walkSnaps(p, acc) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(p)) {
      if (SKIP_DIRS.has(name)) continue;
      walkSnaps(path.join(p, name), acc);
    }
  } else if (p.endsWith(".snap")) acc.push(p);
  return acc;
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
  if (argv.includes("--snapshots")) {
    let n = 0;
    for (const f of roots.flatMap((r) => walkSnaps(r, []))) {
      const src = fs.readFileSync(f, "utf8");
      const out = convertSnapshot(src);
      if (out !== src) {
        n++;
        if (!check) fs.writeFileSync(f, out);
      }
    }
    console.log(`${n} snapshot files ${check ? "would change" : "converted"}`);
    if (check && n) process.exit(1);
    return;
  }
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
