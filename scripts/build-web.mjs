import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { buildWeb } from "../src/web/build.js";

const args = process.argv.slice(2);
const production = !args.includes("--dev");
const outdirIndex = args.indexOf("--outdir");
const outdir = outdirIndex === -1 ? "dist/web" : args[outdirIndex + 1];

if (outdirIndex !== -1 && (!outdir || outdir.startsWith("--"))) {
  console.error("--outdir needs a directory");
  process.exit(1);
}

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else files.push(full);
  }
  return files;
}

const started = performance.now();
let result;
try {
  result = await buildWeb({ production, outdir });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const rows = listFiles(result.outdir)
  .map((file) => ({
    file: relative(result.outdir, file).split("\\").join("/"),
    bytes: statSync(file).size,
  }))
  .sort((a, b) => b.bytes - a.bytes);

for (const row of rows) {
  console.log(`${(row.bytes / 1024).toFixed(1).padStart(10)} KB  ${row.file}`);
}
console.log(`built ${rows.length} files into ${result.outdir} in ${Math.round(performance.now() - started)} ms`);
