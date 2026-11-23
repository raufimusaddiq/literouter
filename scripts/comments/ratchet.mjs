import fs from "node:fs";
import path from "node:path";
import { findComments, listSourceFiles, repoRoot } from "./lib.mjs";

export const BASELINE_FILE = ".comment-baseline.json";
export const WRITE_HINT = "bun scripts/comments/ratchet.mjs --write";

export function countComments(root) {
  const counts = {};
  const failed = [];
  for (const file of listSourceFiles(root)) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    try {
      const n = findComments(fs.readFileSync(full, "utf8"), file).filter((c) => !c.isDirective).length;
      if (n > 0) counts[file] = n;
    } catch (error) {
      failed.push({ file, error: String(error.message ?? error) });
    }
  }
  const sorted = {};
  for (const key of Object.keys(counts).sort()) sorted[key] = counts[key];
  return { counts: sorted, failed };
}

export function compareToBaseline(counts, baseline) {
  const increased = [];
  const decreased = [];
  for (const file of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
    const now = counts[file] ?? 0;
    const allowed = baseline[file] ?? 0;
    if (now > allowed) increased.push({ file, now, allowed });
    else if (now < allowed) decreased.push({ file, now, allowed });
  }
  return { increased, decreased };
}

function main() {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") {
    console.error("Usage: ratchet.mjs [--write|--check]");
    process.exit(2);
  }
  const root = repoRoot();
  const { counts, failed } = countComments(root);
  if (failed.length) {
    for (const f of failed) console.error(`Cannot parse ${f.file}: ${f.error}`);
    process.exit(2);
  }
  const target = path.join(root, BASELINE_FILE);
  if (mode === "--write") {
    fs.writeFileSync(target, JSON.stringify(counts, null, 2) + "\n");
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`Wrote ${BASELINE_FILE}: ${total} comments in ${Object.keys(counts).length} files`);
    return;
  }
  const baseline = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : {};
  const { increased, decreased } = compareToBaseline(counts, baseline);
  if (!increased.length && !decreased.length) {
    console.log("Comment ratchet OK");
    return;
  }
  for (const { file, now, allowed } of increased) {
    console.error(`${file}: ${now} comments, baseline allows ${allowed}. Delete the new comments.`);
  }
  for (const { file, now, allowed } of decreased) {
    console.error(`${file}: ${now} comments, baseline records ${allowed}. The baseline must tighten: run ${WRITE_HINT}`);
  }
  process.exit(1);
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
