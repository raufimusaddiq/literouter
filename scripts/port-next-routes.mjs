import fs from "node:fs";
import path from "node:path";

const HTTP_MODULE = "@/server/http.js";
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const NAME_ORDER = ["json", "redirect", "nextUrl", "cookies"];
const ALIASES = { json: "jsonResponse", redirect: "redirectResponse", nextUrl: "requestUrl", cookies: "requestCookies" };
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx"]);
const SKIPPED_DIRS = new Set(["node_modules", ".next", "dist", ".git"]);
const ID = "[A-Za-z_$][\\w$]*";
const COOKIES_MARKER = "__PORT_COOKIES__";
const REQUEST_NAME = /^_?req(?:uest)?$/;

const NEXT_IMPORT = /^([ \t]*)import\s*\{([^}]*)\}\s*from\s*(["'])next\/(server|headers)\3([ \t]*;?)[ \t]*(\r?\n|$)/gm;
const HTTP_IMPORT = /^([ \t]*import\s*\{)([^}]*)(\}\s*from\s*(["'])@\/server\/http\.js\4)/m;
const ANY_NEXT_IMPORT = /\bfrom\s*(["'])next\/[^"'\n]*\1/;
const IMPORT_STATEMENT = /^import\s+(?:[^"';]*?\sfrom\s*)?(["'])[^"'\n]+\1[ \t]*;?/gm;
const ROUTE_CONFIG_EXPORT = /^[ \t]*export\s+const\s+(?:dynamic|maxDuration|revalidate)\s*=[^\n;]*;?[ \t]*(?:\r?\n|$)/;

const LEFTOVER_RULES = [
  [/\bfrom\s*(["'])next\/[^"'\n]*\1/, "next/* import"],
  [/\bNextResponse\b/, "NextResponse reference"],
  [/\.nextUrl\b/, ".nextUrl access"],
  [/^[ \t]*export\s+const\s+(?:dynamic|maxDuration|revalidate)\b/, "Next route segment export"],
  [/(?<![.\w$])cookies\(\s*\)/, "cookies() without a request"],
];

function parseSpecifiers(list) {
  return list
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [imported, local] = part.split(/\s+as\s+/);
      return { imported, local: local || imported };
    });
}

function formatSpecifier({ imported, local }) {
  return imported === local ? imported : `${imported} as ${local}`;
}

function scanBraces(code) {
  const match = new Map();
  const stack = [];
  const templates = [];
  let prev = "";
  let i = 0;
  const regexAllowedAfter = "(,=:[!&|?{};+-*%<>~^";
  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];
    if (ch === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? code.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i++;
      while (i < code.length && code[i] !== ch && code[i] !== "\n") i += code[i] === "\\" ? 2 : 1;
      i++;
      prev = ch;
      continue;
    }
    if (ch === "`" || (ch === "}" && templates.length && templates[templates.length - 1] === stack.length)) {
      if (ch === "}") {
        templates.pop();
        stack.pop();
      }
      i++;
      let resumed = true;
      while (i < code.length) {
        if (code[i] === "\\") {
          i += 2;
          continue;
        }
        if (code[i] === "`") {
          i++;
          break;
        }
        if (code[i] === "$" && code[i + 1] === "{") {
          stack.push(i + 1);
          templates.push(stack.length);
          i += 2;
          resumed = false;
          break;
        }
        i++;
      }
      if (resumed) prev = "`";
      else prev = "{";
      continue;
    }
    if (ch === "/" && (prev === "" || regexAllowedAfter.includes(prev))) {
      i++;
      let inClass = false;
      while (i < code.length && code[i] !== "\n") {
        if (code[i] === "\\") i++;
        else if (code[i] === "[") inClass = true;
        else if (code[i] === "]") inClass = false;
        else if (code[i] === "/" && !inClass) break;
        i++;
      }
      i++;
      prev = "/";
      continue;
    }
    if (ch === "{") stack.push(i);
    else if (ch === "}") {
      const open = stack.pop();
      if (open !== undefined) match.set(open, i);
    }
    if (!/\s/.test(ch)) prev = ch;
    i++;
  }
  return match;
}

function findFunctions(code, braces) {
  const found = [];
  const named = new RegExp(
    `(export\\s+(?:default\\s+)?)?(async\\s+)?function\\s*\\*?\\s*(${ID})?\\s*\\(([^)]*)\\)\\s*\\{`,
    "g",
  );
  for (const m of code.matchAll(named)) {
    const open = m.index + m[0].length - 1;
    const close = braces.get(open);
    if (close === undefined) continue;
    const paramsStart = m.index + m[0].indexOf("(", m[0].indexOf("function"));
    found.push({
      name: m[3] || "",
      exported: Boolean(m[1]),
      params: m[4],
      paramsStart: paramsStart + 1,
      paramsEnd: paramsStart + 1 + m[4].length,
      open,
      close,
    });
  }
  const arrow = new RegExp(
    `(?:export\\s+const\\s+(${ID})\\s*=\\s*)?(async\\s+)?(?:\\(([^)]*)\\)|(${ID}))\\s*=>\\s*\\{`,
    "g",
  );
  for (const m of code.matchAll(arrow)) {
    const open = m.index + m[0].length - 1;
    const close = braces.get(open);
    if (close === undefined) continue;
    const params = m[3] !== undefined ? m[3] : m[4];
    const paramsStart = m[3] !== undefined ? m.index + m[0].indexOf("(", m[0].indexOf("=") + 1) + 1 : -1;
    found.push({
      name: m[1] || "",
      exported: Boolean(m[1]),
      params,
      paramsStart,
      paramsEnd: paramsStart === -1 ? -1 : paramsStart + params.length,
      open,
      close,
    });
  }
  return found;
}

function firstIdentifier(params) {
  const first = params.split(",")[0].trim().replace(/\s*=.*$/, "");
  return new RegExp(`^${ID}$`).test(first) ? first : null;
}

function resolveRequest(functions, index) {
  const enclosing = functions
    .filter((fn) => fn.open < index && index < fn.close)
    .sort((a, b) => b.open - a.open);
  for (const fn of enclosing) {
    const id = firstIdentifier(fn.params);
    if (id && (REQUEST_NAME.test(id) || (fn.exported && HTTP_METHODS.has(fn.name)))) return { name: id };
  }
  const handler = enclosing.find((fn) => fn.exported && HTTP_METHODS.has(fn.name) && fn.params.trim() === "" && fn.paramsStart !== -1);
  return handler ? { addTo: handler } : null;
}

function hasLocalBinding(code, name) {
  const declared = new RegExp(`\\b(?:const|let|var|function|class)\\s+${name}\\b`);
  const destructured = new RegExp(`[{,]\\s*(?:\\w+\\s*:\\s*)?${name}\\s*(?:[},=])[^;\\n]*\\}\\s*=`);
  const parameter = new RegExp(`\\(([^()]*[(,]\\s*)?${name}\\s*[,)=][^()]*\\)\\s*(?:=>|\\{)`);
  return declared.test(code) || destructured.test(code) || parameter.test(code);
}

function lineOf(code, index) {
  return code.slice(0, index).split("\n").length;
}

function applyEdits(code, edits) {
  let out = code;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function closeParen(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i++;
      while (i < code.length && code[i] !== ch) i += code[i] === "\\" ? 2 : 1;
    } else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  return -1;
}

const VALUE_TAIL = /^\s*(\??)\.value\b/;

function analyzeCookieValues(code, locals) {
  const removals = [];
  const unresolved = [];
  const recv = locals.map(escapeRegex).join("|");
  const jarCall = new RegExp(`(?<![.\\w$])(?:${recv})\\(`, "g");
  const jarVar = new RegExp(`(?:const|let|var)\\s+(${ID})\\s*=\\s*(?:await\\s+)?\\(?\\s*(?:${recv})\\(\\s*[^()\\s]`, "g");
  const jarNames = [...code.matchAll(jarVar)].map((m) => m[1]);
  const receivers = [];
  for (const m of code.matchAll(jarCall)) {
    const open = m.index + m[0].length - 1;
    const close = closeParen(code, open);
    if (close === -1 || !code.slice(open + 1, close).trim()) continue;
    let end = close + 1;
    if (code[end] === ")" && /(?<![\w$.\])])\(\s*(?:await\s+)?$/.test(code.slice(0, m.index))) end++;
    receivers.push({ start: m.index, end });
  }
  if (jarNames.length) {
    const named = new RegExp(`(?<![.\\w$])(?:${jarNames.map(escapeRegex).join("|")})(?=\\s*\\.get\\()`, "g");
    for (const m of code.matchAll(named)) receivers.push({ start: m.index, end: m.index + m[0].length });
  }
  const entryNames = new Set();
  for (const { start, end } of receivers) {
    const get = /^\s*\.get\(/.exec(code.slice(end));
    if (!get) continue;
    const close = closeParen(code, end + get[0].length - 1);
    if (close === -1) continue;
    const tail = VALUE_TAIL.exec(code.slice(close + 1));
    if (tail) {
      const optional = tail[1] === "?";
      const next = code[close + 1 + tail[0].length];
      removals.push({ start: close + 1, end: close + 1 + tail[0].length, text: optional && next === "." ? "?" : "" });
      continue;
    }
    const declared = /(?:const|let|var)\s+([\w$]+)\s*=\s*(?:await\s+)?\(?\s*$/.exec(code.slice(Math.max(0, start - 80), start));
    if (declared) entryNames.add(declared[1]);
  }
  for (const name of entryNames) {
    for (const m of code.matchAll(new RegExp(`(?<![.\\w$])${escapeRegex(name)}\\s*\\??\\.value\\b`, "g"))) {
      unresolved.push({ index: m.index, label: `.value on ${name}, a value from the cookie jar (it is a string now)` });
    }
  }
  for (const m of code.matchAll(new RegExp(`(?<![\\w$])${ID}\\.cookies\\s*\\.get\\(`, "g"))) {
    const close = closeParen(code, m.index + m[0].length - 1);
    if (close !== -1 && VALUE_TAIL.test(code.slice(close + 1))) {
      unresolved.push({ index: m.index, label: "request.cookies.get(...).value (a Web Request has no .cookies; use cookies(request).get(name))" });
    }
  }
  return { removals, unresolved };
}

function cookieLocals(existingLocal, chosenLocal) {
  return [...new Set(["cookies", ALIASES.cookies, existingLocal, chosenLocal].filter(Boolean))];
}

function stripRouteConfig(code) {
  const lines = code.split(/(?<=\n)/);
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    if (!ROUTE_CONFIG_EXPORT.test(lines[i])) {
      kept.push(lines[i]);
      continue;
    }
    const before = kept.length ? kept[kept.length - 1] : null;
    const after = lines[i + 1];
    if (before !== null && before.trim() === "" && after !== undefined && after.trim() === "") i++;
  }
  return kept.join("");
}

function insertImport(code, statement, eol) {
  let last = null;
  for (const m of code.matchAll(IMPORT_STATEMENT)) last = m;
  if (!last) return statement + eol + code;
  const end = last.index + last[0].length;
  const lineEnd = code.slice(end).match(/^[ \t]*(\r?\n)?/)[0];
  const insertAt = end + lineEnd.length;
  const needsBreak = lineEnd.includes("\n") ? "" : eol;
  return code.slice(0, insertAt) + needsBreak + statement + eol + code.slice(insertAt);
}

export function transformWithReport(source, filePath = "") {
  const followUps = [];
  const note = (message) => followUps.push(`${filePath || "<source>"}: ${message}`);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";

  let removedCookiesImport = false;
  let quote = null;
  let semicolon = null;
  for (const m of source.matchAll(NEXT_IMPORT)) {
    if (quote === null) {
      quote = m[3];
      semicolon = m[5].includes(";");
    }
    for (const spec of parseSpecifiers(m[2])) {
      if (m[4] === "headers" && spec.imported === "cookies" && spec.local === "cookies") removedCookiesImport = true;
    }
  }

  let code = source;
  if (removedCookiesImport) {
    const functions = findFunctions(code, scanBraces(code));
    const edits = [];
    for (const m of code.matchAll(/(?<![.\w$])(?:await\s+)?cookies\(\s*\)/g)) {
      const resolved = resolveRequest(functions, m.index);
      let name = resolved?.name;
      if (resolved?.addTo) {
        const fn = resolved.addTo;
        name = "request";
        if (!edits.some((e) => e.start === fn.paramsStart)) {
          edits.push({ start: fn.paramsStart, end: fn.paramsEnd, text: name });
          note(`added a request parameter to ${fn.name}() so cookies(request) resolves`);
        }
      }
      if (name) edits.push({ start: m.index, end: m.index + m[0].length, text: `${COOKIES_MARKER}(${name})` });
      else note(`cookies() at line ${lineOf(code, m.index)} has no request in scope; pass the request in by hand`);
    }
    code = applyEdits(code, edits);
  }

  const existing = HTTP_IMPORT.exec(code);
  const existingLocals = new Map();
  if (existing) for (const spec of parseSpecifiers(existing[2])) existingLocals.set(spec.imported, spec.local);
  const bodyForBindings = code.replace(HTTP_IMPORT, "").replace(NEXT_IMPORT, "");
  const need = new Set();
  const chosen = new Map();
  const localFor = (name) => {
    need.add(name);
    if (existingLocals.has(name)) return existingLocals.get(name);
    if (!chosen.has(name)) chosen.set(name, hasLocalBinding(bodyForBindings, name) ? ALIASES[name] : name);
    return chosen.get(name);
  };

  code = code.replace(/\bNextResponse\.json\(/g, () => `${localFor("json")}(`);
  code = code.replace(/\bNextResponse\.redirect\(/g, () => `${localFor("redirect")}(`);
  code = code.replace(/\bnew\s+NextResponse\(/g, "new Response(");
  code = code.replace(new RegExp(`(?<![.\\w$])(${ID})\\.nextUrl\\?\\.`, "g"), (_, id) => `${localFor("nextUrl")}(${id}).`);
  code = code.replace(new RegExp(`(?<![.\\w$])(${ID})\\.nextUrl\\b`, "g"), (_, id) => `${localFor("nextUrl")}(${id})`);
  code = code.replaceAll(`${COOKIES_MARKER}(`, () => `${localFor("cookies")}(`);
  code = stripRouteConfig(code);

  const locals = cookieLocals(existingLocals.get("cookies"), chosen.get("cookies"));
  if (removedCookiesImport || existingLocals.has("cookies")) {
    code = applyEdits(code, analyzeCookieValues(code, locals).removals);
  }
  for (const item of analyzeCookieValues(code, locals).unresolved) {
    note(`line ${lineOf(code, item.index)}: ${item.label}; fix by hand`);
  }

  if (/\bnextUrl\([^)]*\)\.(?:clone|basePath|locale|buildId)\b/.test(code)) {
    note("a NextURL-only member (clone/basePath/locale/buildId) is used on nextUrl(); a plain URL has none of them");
  }

  const stillUsesNextResponse = /\bNextResponse\b/.test(code.replace(NEXT_IMPORT, ""));
  if (stillUsesNextResponse) {
    const members = new Set([...code.matchAll(/\bNextResponse\.(\w+)/g)].map((m) => `NextResponse.${m[1]}`));
    for (const member of members) note(`${member} has no Web Response equivalent here; port it by hand`);
    if (!members.size) note("NextResponse is still referenced; port it by hand");
  }

  const names = NAME_ORDER.filter((name) => need.has(name));
  const specifier = (name) => formatSpecifier({ imported: name, local: localFor(name) });
  let httpLine = null;
  if (existing) {
    const missing = names.filter((name) => !existingLocals.has(name));
    if (missing.length) {
      const merged = [...parseSpecifiers(existing[2]).map(formatSpecifier), ...missing.map(specifier)];
      code = code.replace(HTTP_IMPORT, (_all, head, _list, tail) => `${head} ${merged.join(", ")} ${tail}`);
    }
  } else if (names.length) {
    const q = quote || '"';
    httpLine = `import { ${names.map(specifier).join(", ")} } from ${q}${HTTP_MODULE}${q}${semicolon === false ? "" : ";"}`;
  }

  const rebuilt = [];
  let cursor = 0;
  let placed = false;
  for (const m of [...code.matchAll(NEXT_IMPORT)]) {
    const origin = `next/${m[4]}`;
    const keep = parseSpecifiers(m[2]).filter((spec) => {
      if (origin === "next/server" && spec.imported === "NextResponse" && spec.local === "NextResponse") return stillUsesNextResponse;
      return !(origin === "next/headers" && spec.imported === "cookies" && spec.local === "cookies");
    });
    const lines = [];
    if (!placed && httpLine) {
      lines.push(`${m[1]}${httpLine}`);
      placed = true;
    }
    if (keep.length) {
      lines.push(`${m[1]}import { ${keep.map(formatSpecifier).join(", ")} } from ${m[3]}${origin}${m[3]}${m[5]}`);
      for (const spec of keep) if (spec.imported !== "NextResponse") note(`${spec.imported} from ${origin} needs a manual port`);
    }
    rebuilt.push(code.slice(cursor, m.index), lines.length ? lines.join(eol) + m[6] : "");
    cursor = m.index + m[0].length;
  }
  rebuilt.push(code.slice(cursor));
  code = rebuilt.join("");
  if (httpLine && !placed) code = insertImport(code, httpLine, eol);

  for (const m of code.matchAll(new RegExp(ANY_NEXT_IMPORT.source, "g"))) {
    const target = m[0].replace(/^from\s*/, "");
    if (!followUps.some((f) => f.includes(target))) note(`import ${target} needs a manual port`);
  }
  return { code, followUps };
}

export function transform(source, filePath = "") {
  return transformWithReport(source, filePath).code;
}

export function findLeftovers(source) {
  const leftovers = [];
  source.split(/\r?\n/).forEach((line, index) => {
    for (const [pattern, label] of LEFTOVER_RULES) {
      if (pattern.test(line)) leftovers.push({ line: index + 1, label, text: line.trim() });
    }
  });
  const lines = source.split(/\r?\n/);
  const imported = HTTP_IMPORT.exec(source);
  const jarLocal = imported && parseSpecifiers(imported[2]).find((spec) => spec.imported === "cookies")?.local;
  const analysis = analyzeCookieValues(source, cookieLocals(jarLocal));
  for (const hit of analysis.removals) {
    const line = lineOf(source, hit.start);
    leftovers.push({ line, label: ".value on a cookie jar .get(...) result (it is a string now)", text: lines[line - 1].trim() });
  }
  for (const hit of analysis.unresolved) {
    const line = lineOf(source, hit.index);
    leftovers.push({ line, label: hit.label, text: lines[line - 1].trim() });
  }
  return leftovers.sort((a, b) => a.line - b.line);
}

function collectFiles(target, out) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (SOURCE_EXTENSIONS.has(path.extname(target))) out.push(target);
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) collectFiles(path.join(target, entry.name), out);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(path.join(target, entry.name));
    }
  }
}

export function run(argv, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }) {
  const check = argv.includes("--check");
  const targets = argv.filter((arg) => !arg.startsWith("--"));
  if (!targets.length) targets.push("src/app/api");
  const files = [];
  for (const target of targets) {
    if (!fs.existsSync(target)) {
      io.err(`port-next-routes: no such path: ${target}\n`);
      return 2;
    }
    collectFiles(target, files);
  }
  files.sort();

  if (check) {
    let failures = 0;
    for (const file of files) {
      for (const hit of findLeftovers(fs.readFileSync(file, "utf8"))) {
        failures++;
        io.err(`${file}:${hit.line}: ${hit.label}: ${hit.text}\n`);
      }
    }
    if (failures) io.err(`port-next-routes: ${failures} Next.js leftover(s)\n`);
    return failures ? 1 : 0;
  }

  let changed = 0;
  for (const file of files) {
    const original = fs.readFileSync(file, "utf8");
    const { code, followUps } = transformWithReport(original, file);
    if (code !== original) {
      fs.writeFileSync(file, code);
      changed++;
    }
    for (const followUp of followUps) io.err(`${followUp}\n`);
  }
  io.out(`port-next-routes: ${changed} of ${files.length} file(s) rewritten\n`);
  return 0;
}

if (import.meta.main) {
  process.exitCode = run(process.argv.slice(2));
}
