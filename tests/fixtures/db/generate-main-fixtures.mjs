import fs from "node:fs";
import path from "node:path";

const root = process.env.REPO_ROOT;
const out = process.env.OUT_DIR;
const seedPath = process.env.SEED_FILE;

process.env.DATA_DIR = path.join(out, "data");
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });

const { importDb, exportDb } = await import(`file://${root}/src/lib/db/index.js`);
const { getAdapter } = await import(`file://${root}/src/lib/db/driver.js`);

const adapter = await getAdapter();
await importDb(JSON.parse(fs.readFileSync(seedPath, "utf8")));
const exported = await exportDb();
fs.writeFileSync(path.join(out, "main-export.json"), `${JSON.stringify(exported, null, 2)}\n`);
adapter.checkpoint?.();
adapter.close?.();
fs.copyFileSync(path.join(process.env.DATA_DIR, "db", "data.sqlite"), path.join(out, "main-written.sqlite"));
console.log(JSON.stringify({ driver: adapter.driver, node: process.version, tables: Object.keys(exported) }));
