import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findComments, parseSource, repoRoot } from "./lib.mjs";

const DELETE_CATEGORIES = new Set(["tautology", "stale", "excuse", "decision"]);
const KEEP_CATEGORIES = new Set(["keep"]);

export function removeComment(source, comment) {
  const { start, end } = comment;
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const nl = source.indexOf("\n", end);
  const lineEnd = nl === -1 ? source.length : nl;
  const before = source.slice(lineStart, start);
  const after = source.slice(end, lineEnd);
  const beforeBlank = /^\s*$/.test(before);
  const afterBlank = /^\s*$/.test(after);

  if (beforeBlank && afterBlank) {
    if (nl !== -1) return source.slice(0, lineStart) + source.slice(nl + 1);
    let cut = lineStart;
    if (cut > 0) cut -= 1;
    if (cut > 0 && source[cut - 1] === "\r") cut -= 1;
    return source.slice(0, cut) + source.slice(lineEnd);
  }

  if (afterBlank) {
    const cr = after.endsWith("\r") ? "\r" : "";
    return source.slice(0, lineStart) + before.replace(/[ \t]+$/, "") + cr + source.slice(lineEnd);
  }

  if (beforeBlank) {
    const lead = after.match(/^[ \t]*/)[0].length;
    return source.slice(0, start) + source.slice(end + lead);
  }

  const lead = after.match(/^[ \t]*/)[0].length;
  const trail = before.match(/[ \t]*$/)[0].length;
  const head = source.slice(0, start - trail);
  const tail = source.slice(end + lead);
  const spansLines = source.slice(start, end).includes("\n");
  if (spansLines) {
    const eol = source.slice(start, end).includes("\r\n") ? "\r\n" : "\n";
    return head + eol + tail;
  }
  const kept = before.slice(before.length - trail);
  if (/^[,;)\]}.]/.test(tail)) return head + tail;
  if (/\w$/.test(head) && /^\w/.test(tail)) return head + " " + tail;
  return head + (trail ? kept : "") + tail;
}

export function applyToSource(source, targets) {
  const ordered = [...targets].sort((a, b) => b.start - a.start);
  let next = source;
  for (const comment of ordered) next = removeComment(next, comment);
  return next;
}

export function applyDecisions({ root, decisions, dryRun = false, verify = parseSource }) {
  const summary = { filesChanged: 0, deleted: 0, skipped: [], failedFiles: [] };
  const byFile = new Map();
  const seen = new Set();
  for (const decision of decisions) {
    const { id, category } = decision;
    if (!DELETE_CATEGORIES.has(category) && !KEEP_CATEGORIES.has(category)) {
      throw new Error(`Unknown category "${category}" for ${id}`);
    }
    if (KEEP_CATEGORIES.has(category) || seen.has(id)) continue;
    seen.add(id);
    const file = id.slice(0, id.lastIndexOf("#"));
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(id);
  }

  for (const [file, ids] of byFile) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) {
      for (const id of ids) summary.skipped.push({ id, reason: "file not found" });
      continue;
    }
    const source = fs.readFileSync(full, "utf8");
    let comments;
    try {
      comments = findComments(source, file);
    } catch (error) {
      summary.failedFiles.push({ file, error: String(error.message ?? error) });
      continue;
    }
    const index = new Map(comments.map((c) => [c.id, c]));
    const targets = [];
    for (const id of ids) {
      const comment = index.get(id);
      if (!comment) summary.skipped.push({ id, reason: "comment no longer present" });
      else if (comment.isDirective) summary.skipped.push({ id, reason: "directive comments are never deleted" });
      else targets.push(comment);
    }
    if (!targets.length) continue;

    const result = applyToSource(source, targets);
    try {
      verify(result);
      const remaining = findComments(result, file).length;
      if (remaining !== comments.length - targets.length) {
        throw new Error(`expected ${comments.length - targets.length} comments after deletion, found ${remaining}`);
      }
    } catch (error) {
      summary.failedFiles.push({ file, error: String(error.message ?? error) });
      continue;
    }
    summary.deleted += targets.length;
    summary.filesChanged += 1;
    if (!dryRun) fs.writeFileSync(full, result);
  }
  return summary;
}

function parseArgs(argv) {
  const args = { dryRun: false, decisions: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--decisions") args.decisions = argv[++i];
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  if (!args.decisions) throw new Error("Usage: apply.mjs --decisions <file.jsonl> [--dry-run]");
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let root = process.cwd();
  try {
    root = repoRoot(root);
  } catch {
    root = process.cwd();
  }
  const decisions = fs
    .readFileSync(args.decisions, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const summary = applyDecisions({ root, decisions, dryRun: args.dryRun });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failedFiles.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
