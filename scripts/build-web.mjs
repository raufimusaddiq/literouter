import { buildWeb } from "../src/web/build.js";

const args = process.argv.slice(2);
const production = !args.includes("--dev");
const outdirIndex = args.indexOf("--outdir");
const outdir = outdirIndex === -1 ? "dist/web" : args[outdirIndex + 1];

if (outdirIndex !== -1 && !outdir) {
  console.error("--outdir needs a directory");
  process.exit(1);
}

const started = performance.now();
let result;
try {
  result = await buildWeb({ production, outdir });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const rows = Object.entries(result.metafile.outputs)
  .map(([file, output]) => ({ file: file.split("\\").join("/"), bytes: output.bytes }))
  .sort((a, b) => b.bytes - a.bytes);

for (const row of rows) {
  console.log(`${(row.bytes / 1024).toFixed(1).padStart(10)} KB  ${row.file}`);
}
console.log(`built ${rows.length} files into ${result.outdir} in ${Math.round(performance.now() - started)} ms`);
