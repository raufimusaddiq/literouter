import fs from "node:fs";
import initSqlJs from "sql.js";
import { PRAGMA_SQL } from "../schema.js";
import { drainRuntimeBuffersSync } from "../shutdown.js";

let SQL = null;

async function loadSql() {
  if (SQL) return SQL;
  SQL = await initSqlJs();
  return SQL;
}

export async function createSqlJsAdapter(filePath) {
  const SQLLib = await loadSql();
  const buf = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  const db = new SQLLib.Database(buf);
  db.exec(PRAGMA_SQL);
  // Schema is created/synced by migrate.js after adapter init

  let dirty = false;
  let saveTimer = null;
  let firstDirtyAt = 0;
  const SAVE_DEBOUNCE_MS = 100;
  // Under steady writes the debounce alone would postpone the save forever.
  const SAVE_MAX_WAIT_MS = Number(process.env.SQLJS_SAVE_MAX_WAIT_MS) > 0
    ? Number(process.env.SQLJS_SAVE_MAX_WAIT_MS)
    : 5000;

  // Atomic: write a sibling tmp file then rename over the target.
  function persist() {
    const data = db.export();
    const tmp = `${filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, Buffer.from(data));
      fs.renameSync(tmp, filePath);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      throw e;
    }
    dirty = false;
    firstDirtyAt = 0;
  }

  function saveNow() {
    saveTimer = null;
    if (dirty) {
      try { persist(); } catch (e) { console.error("[sqljs] save failed:", e); }
    }
  }

  function scheduleSave() {
    const now = Date.now();
    if (!dirty || !firstDirtyAt) firstDirtyAt = now;
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    const untilMax = Math.max(0, firstDirtyAt + SAVE_MAX_WAIT_MS - now);
    saveTimer = setTimeout(saveNow, Math.min(SAVE_DEBOUNCE_MS, untilMax));
  }

  function paramsObj(params) {
    if (!params || (Array.isArray(params) && params.length === 0)) return undefined;
    return params;
  }

  function run(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      stmt.step();
      const changes = db.getRowsModified();
      const lastInsertRowid = db.exec("SELECT last_insert_rowid() as id")[0]?.values?.[0]?.[0] ?? null;
      scheduleSave();
      return { changes, lastInsertRowid };
    } finally {
      stmt.free();
    }
  }

  function get(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      if (stmt.step()) return stmt.getAsObject();
      return undefined;
    } finally {
      stmt.free();
    }
  }

  function all(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function exec(sql) {
    db.exec(sql);
    scheduleSave();
  }

  function transaction(fn) {
    const sp = `sp_${Math.random().toString(36).slice(2)}`;
    db.exec(`SAVEPOINT ${sp}`);
    try {
      const result = fn();
      db.exec(`RELEASE ${sp}`);
      scheduleSave();
      return result;
    } catch (e) {
      try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch {}
      throw e;
    }
  }

  function close() {
    if (saveTimer) clearTimeout(saveTimer);
    drainRuntimeBuffersSync();
    if (dirty) persist();
    db.close();
  }

  // Flush accepted runtime events first; their writes mark sql.js dirty and
  // must be included in the final exported database image.
  const flush = () => {
    drainRuntimeBuffersSync();
    if (dirty) try { persist(); } catch {}
  };
  process.on("beforeExit", flush);
  process.on("SIGINT", flush);
  process.on("SIGTERM", flush);

  return { driver: "sql.js", run, get, all, exec, transaction, close, raw: db };
}
