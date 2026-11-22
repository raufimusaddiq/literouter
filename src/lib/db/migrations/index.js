import m001 from "./001-initial.js";
import m002 from "./002-purge-mitm-alias.js";
import m003 from "./003-fingerprint-usage-api-keys.js";
import m004 from "./004-usage-history-apikey-index.js";
import m005 from "./005-usage-rollup.js";

export const MIGRATIONS = [m001, m002, m003, m004, m005].sort((a, b) => a.version - b.version);

export function latestVersion() {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}
