import { ensureDirs, DATA_FILE } from "./paths.js";
import { stripNullBytes } from "./helpers/nullBytes.js";

if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

function withNullByteSafeParams(adapter) {
  const clean = (params) => (Array.isArray(params) ? params.map(stripNullBytes) : params);
  return {
    ...adapter,
    run: (sql, params = []) => adapter.run(sql, clean(params)),
    get: (sql, params = []) => adapter.get(sql, clean(params)),
    all: (sql, params = []) => adapter.all(sql, clean(params)),
  };
}

async function initAdapter() {
  ensureDirs();
  if (!process.versions.bun) throw new Error("LiteRouter requires the Bun runtime (bun:sqlite)");
  const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
  const adapter = withNullByteSafeParams(await createBunSqliteAdapter(DATA_FILE));

  if (!state.logged) {
    console.log(`[DB] Driver: ${adapter.driver} | file: ${DATA_FILE}`);
    state.logged = true;
  }

  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter);
  return adapter;
}

export async function getAdapter() {
  if (state.instance) return state.instance;
  if (!state.initPromise) {
    state.initPromise = initAdapter().then(
      (a) => { state.instance = a; return a; },
      (e) => { state.initPromise = null; throw e; }
    );
  }
  return state.initPromise;
}

export function getAdapterSync() {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}
