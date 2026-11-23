import { describe, expect, it } from "bun:test";
import { clearRollupKeyCache, getRollupKeyId } from "@/lib/db/usageRollup.js";

function makeDb() {
  const committed = new Map();
  let pending = null;
  let seq = 0;
  const keyOf = (t) => t.join("|");
  return {
    run(_sql, tuple) {
      const store = pending || committed;
      if (!committed.has(keyOf(tuple)) && !(pending && pending.has(keyOf(tuple)))) store.set(keyOf(tuple), ++seq);
    },
    get(_sql, tuple) {
      const k = keyOf(tuple);
      return { id: (pending && pending.get(k)) ?? committed.get(k) };
    },
    transaction(fn) {
      pending = new Map();
      try { fn(); for (const [k, v] of pending) committed.set(k, v); } finally { pending = null; }
    },
  };
}

describe("rollup key cache vs rollback", () => {
  it("does not reuse an id from a rolled-back txn once the cache is cleared", () => {
    const db = makeDb();
    const A = ["p", "mA", "c", "k", "e"];
    const B = ["p", "mB", "c", "k", "e"];
    let staleId;
    expect(() => db.transaction(() => { staleId = getRollupKeyId(db, A); throw new Error("boom"); })).toThrow("boom");
    clearRollupKeyCache(db);
    db.transaction(() => { getRollupKeyId(db, B); });
    let idA;
    db.transaction(() => { idA = getRollupKeyId(db, A); });
    expect(idA).not.toBe(getRollupKeyId(db, B));
    expect(staleId).toBeDefined();
  });
});
