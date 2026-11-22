// The tunnel/Tailscale/MITM runtime was deleted in PR #14. Nothing retained
// reads its settings or mitmAlias scope, so stale state is dropped on upgrade.
const REMOVED_SETTINGS = [
  "tunnelEnabled",
  "tunnelUrl",
  "tunnelProvider",
  "tailscaleEnabled",
  "tailscaleUrl",
  "tunnelDashboardAccess",
  "mitmRouterBaseUrl",
  "mitmSudoEncrypted",
];

export default {
  version: 2,
  name: "purge-mitm-alias",
  up(db) {
    db.exec("CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, data TEXT NOT NULL)");
    db.exec("CREATE TABLE IF NOT EXISTS kv (scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (scope, key))");
    db.run(
      `DELETE FROM kv WHERE scope IN ('mitmAlias', 'mitmSudoEncrypted')`
    );
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    if (!row) return;
    const settings = JSON.parse(row.data || "{}");
    for (const key of REMOVED_SETTINGS) delete settings[key];
    db.run(`UPDATE settings SET data = ? WHERE id = 1`, [JSON.stringify(settings)]);
  },
};
