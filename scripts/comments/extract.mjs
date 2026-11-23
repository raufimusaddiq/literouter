import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findComments, listSourceFiles, repoRoot } from "./lib.mjs";

const CONTEXT_LINES = 6;

function parseArgs(argv) {
  const args = { out: null, batchSize: 450, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--batch-size") args.batchSize = Number(argv[++i]);
    else if (argv[i].startsWith("--")) throw new Error(`Unknown argument ${argv[i]}`);
    else args.paths.push(argv[i].replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, ""));
  }
  if (!args.out) throw new Error("Usage: extract.mjs --out <dir> [--batch-size 450] [paths...]");
  if (!Number.isInteger(args.batchSize) || args.batchSize < 1) throw new Error("--batch-size must be a positive integer");
  return args;
}

export function planBatches(entries, batchSize) {
  const batches = [];
  let current = null;
  for (const entry of entries) {
    if (current && current.comments + entry.count > batchSize) {
      batches.push(current);
      current = null;
    }
    current ??= { comments: 0, files: [] };
    current.comments += entry.count;
    current.files.push(entry.file);
  }
  if (current) batches.push(current);
  return batches;
}

export function extract({ root, out, batchSize = 450, paths = [] }) {
  let files = listSourceFiles(root);
  if (paths.length) {
    files = files.filter((f) => paths.some((p) => f === p || f.startsWith(p + "/")));
  }
  files.sort();

  const perFile = [];
  const fileHashes = {};
  const failed = [];
  for (const file of files) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const source = fs.readFileSync(full, "utf8");
    let found;
    try {
      found = findComments(source, file).filter((c) => !c.isDirective);
    } catch (error) {
      failed.push({ file, error: String(error.message ?? error) });
      continue;
    }
    if (!found.length) continue;
    const lines = source.split("\n").map((l) => l.replace(/\r$/, ""));
    const records = found.map((c) => ({
      id: c.id,
      file: c.file,
      kind: c.kind,
      startLine: c.startLine,
      endLine: c.endLine,
      text: c.text,
      before: lines.slice(Math.max(0, c.startLine - 1 - CONTEXT_LINES), c.startLine - 1).join("\n"),
      after: lines.slice(c.endLine, c.endLine + CONTEXT_LINES).join("\n"),
    }));
    fileHashes[file] = crypto.createHash("sha256").update(source).digest("hex");
    perFile.push({ file, count: records.length, records });
  }

  const plan = planBatches(
    perFile.map((p) => ({ file: p.file, count: p.count })),
    batchSize
  );
  const byFile = new Map(perFile.map((p) => [p.file, p]));

  fs.mkdirSync(path.join(out, "batches"), { recursive: true });
  const toLines = (records) => records.map((r) => JSON.stringify(r) + "\n").join("");
  fs.writeFileSync(path.join(out, "comments.jsonl"), toLines(perFile.flatMap((p) => p.records)));

  const width = Math.max(2, String(plan.length).length);
  const batches = plan.map((batch, i) => {
    const name = `batch-${String(i + 1).padStart(width, "0")}`;
    const records = batch.files.flatMap((f) => byFile.get(f).records);
    fs.writeFileSync(path.join(out, "batches", `${name}.jsonl`), toLines(records));
    return { name, comments: batch.comments, files: batch.files.length };
  });

  const manifest = {
    totalComments: perFile.reduce((n, p) => n + p.count, 0),
    files: perFile.length,
    batches,
    fileHashes,
    failed,
  };
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = extract({ root: repoRoot(), out: path.resolve(args.out), batchSize: args.batchSize, paths: args.paths });
  for (const f of manifest.failed) console.error(`Cannot parse ${f.file}: ${f.error}`);
  console.log(
    `${manifest.totalComments} comments in ${manifest.files} files, ${manifest.batches.length} batches: ` +
      manifest.batches.map((b) => b.comments).join(", ")
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
