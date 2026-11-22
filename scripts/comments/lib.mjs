import { execFileSync } from "node:child_process";
import { parse } from "espree";

const SOURCE_EXT = /\.(js|jsx|mjs|cjs)$/;

const DIRECTIVE_START =
  /^(eslint-disable|eslint-enable|eslint |global |globals |jshint|istanbul |c8 |@ts-|prettier-ignore|#__PURE__|@__PURE__|#__NO_SIDE_EFFECTS__)/;
const DIRECTIVE_ANYWHERE = /webpackIgnore|webpackChunkName|webpackMode|@vite-ignore|@(license|preserve|jsx|jsxImportSource)\b/;

export function isDirectiveText(text) {
  const head = text.replace(/^[\s/*!]+/, "");
  return DIRECTIVE_START.test(head) || DIRECTIVE_ANYWHERE.test(text);
}

function stripShebang(source) {
  if (!source.startsWith("#!")) return source;
  const end = source.search(/\r?\n/);
  const stop = end === -1 ? source.length : end;
  return " ".repeat(stop) + source.slice(stop);
}

export function parseSource(source) {
  const base = { ecmaVersion: "latest", comment: true, loc: true, range: true };
  const attempts = [
    { ...base, sourceType: "module", ecmaFeatures: { jsx: true } },
    { ...base, sourceType: "script", ecmaFeatures: { jsx: true, globalReturn: true } },
  ];
  const text = stripShebang(source);
  let firstError;
  for (const options of attempts) {
    try {
      return parse(text, options);
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError;
}

function collectEmptyJsxContainers(ast) {
  const found = [];
  const stack = [ast];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    if (node.type === "JSXExpressionContainer" && node.expression?.type === "JSXEmptyExpression") {
      found.push({ range: node.range, loc: node.loc });
      continue;
    }
    for (const key of Object.keys(node)) {
      if (key === "tokens" || key === "comments" || key === "loc" || key === "range") continue;
      const value = node[key];
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return found;
}

export function toPosix(file) {
  return file.replace(/\\/g, "/");
}

export function findComments(source, filePath) {
  const file = toPosix(filePath);
  const ast = parseSource(source);
  const containers = collectEmptyJsxContainers(ast);
  const inside = new Map();
  for (const container of containers) inside.set(container, []);
  const plain = [];
  for (const comment of ast.comments) {
    const owner = containers.find((c) => comment.range[0] >= c.range[0] && comment.range[1] <= c.range[1]);
    if (owner) inside.get(owner).push(comment);
    else plain.push({ comment, range: comment.range, loc: comment.loc, kind: comment.type === "Line" ? "Line" : "Block" });
  }
  const out = [];
  for (const [container, list] of inside) {
    if (list.length === 1) {
      out.push({ comment: list[0], range: container.range, loc: container.loc, kind: "Jsx" });
    } else {
      for (const comment of list) {
        out.push({ comment, range: comment.range, loc: comment.loc, kind: comment.type === "Line" ? "Line" : "Block" });
      }
    }
  }
  const all = [...plain, ...out].sort((a, b) => a.range[0] - b.range[0]);
  return all.map(({ comment, range, loc, kind }) => {
    const startLine = loc.start.line;
    const col = loc.start.column;
    return {
      id: `${file}#${startLine}:${col}`,
      file,
      kind,
      text: comment.value,
      start: range[0],
      end: range[1],
      startLine,
      startCol: col,
      endLine: loc.end.line,
      isDirective: isDirectiveText(comment.value),
    };
  });
}

export function repoRoot(cwd = process.cwd()) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
}

export function listSourceFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  return out
    .split("\0")
    .filter((file) => file && SOURCE_EXT.test(file))
    .map(toPosix);
}
