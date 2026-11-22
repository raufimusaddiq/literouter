// Minimal parser for `bun test --reporter=junit` output. No XML dependency.
// Layout: <testsuites errors="N"> > file <testsuite> > nested describe <testsuite>s > <testcase>.
// `<skipped/>` (skip and todo) -> "skipped"; <failure>/<error> child -> "failed".

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const decode = s =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isNaN(cp) ? m : String.fromCodePoint(cp);
    }
    return ENTITIES[e] ?? m;
  });

// Report paths may be absolute/backslashed; known-fails keys are "tests/<path>".
export function relativeFile(name) {
  const n = name.split(String.fromCharCode(92)).join("/");
  const j = n.lastIndexOf("/tests/");
  if (j >= 0) return n.slice(j + 1);
  if (n.startsWith("tests/")) return n;
  return "tests/" + n.replace(/^\.\//, ""); // bun run from tests/ emits cwd-relative paths
}

const attrs = str => {
  const out = {};
  for (const m of str.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
};

export function parseJunit(xml) {
  const cases = [];
  let errors = 0;
  const stack = []; // open testsuites: { name, file }
  let current = null; // open testcase
  const tagRe = /<(\/?)([a-zA-Z]+)\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(xml))) {
    const [, close, tag, rawAttrs, selfClose] = m;
    if (tag === "testsuites" && !close) {
      errors = Number(attrs(rawAttrs).errors ?? 0) || 0;
    } else if (tag === "testsuite") {
      if (close) stack.pop();
      else {
        const a = attrs(rawAttrs);
        stack.push({ name: a.name ?? "", file: a.file });
        if (selfClose) stack.pop();
      }
    } else if (tag === "testcase" && !close) {
      const a = attrs(rawAttrs);
      // stack[0] is the file-level suite; deeper entries are describes.
      const file = relativeFile(stack[0]?.file ?? a.file ?? "");
      const names = [...stack.slice(1).map(s => s.name), a.name ?? ""];
      current = { file, fullName: names.join(" "), status: "passed" };
      cases.push(current);
      if (selfClose) current = null;
    } else if (tag === "testcase" && close) {
      current = null;
    } else if (current && !close && (tag === "failure" || tag === "error")) {
      current.status = "failed";
    } else if (current && !close && tag === "skipped") {
      if (current.status !== "failed") current.status = "skipped";
    }
  }
  return { cases, errors };
}
