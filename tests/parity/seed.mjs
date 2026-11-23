import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const dataDir = args[0];
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const upstream = flag("--upstream");
if (!dataDir || !upstream) {
  console.error("usage: bun tests/parity/seed.mjs <dataDir> --upstream <url> [--print-key]");
  process.exit(2);
}

const resolved = path.resolve(dataDir);
fs.mkdirSync(resolved, { recursive: true });
process.env.DATA_DIR = resolved;

const raw = fs.readFileSync(new URL("./fixtures/seed.json", import.meta.url), "utf8").replaceAll("__UPSTREAM__", upstream.replace(/\/$/, ""));
const payload = JSON.parse(raw);

const { importDb } = await import("../../src/lib/db/index.js");
await importDb(payload);
await global._dbAdapter?.instance?.close?.();

if (args.includes("--print-key")) console.log(payload.apiKeys[0].key);
process.exit(0);
