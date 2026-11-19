const test = require("node:test");
const assert = require("node:assert");
const { parseNetstatListeners, findListenerPid, buildTrayArgs } = require("../src/cli/utils/serverProc");

// Real `netstat -ano -p TCP` shape (IPv4 + IPv6, one non-listening row).
const NETSTAT = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:2012           0.0.0.0:0              LISTENING       4001
  TCP    0.0.0.0:20128          0.0.0.0:0              LISTENING       4002
  TCP    127.0.0.1:20128        127.0.0.1:54321        ESTABLISHED     4003
  TCP    [::]:20128             [::]:0                 LISTENING       4004
`;

test("parseNetstatListeners keeps only LISTENING rows", () => {
  const listeners = parseNetstatListeners(NETSTAT);
  assert.deepStrictEqual(
    listeners.map((l) => `${l.port}:${l.pid}`),
    ["2012:4001", "20128:4002", "20128:4004"]
  );
});

test("findListenerPid matches the port exactly, never by prefix", () => {
  assert.strictEqual(findListenerPid(NETSTAT, 2012), 4001);
  assert.strictEqual(findListenerPid(NETSTAT, 20128), 4002);
  assert.strictEqual(findListenerPid(NETSTAT, 201), null);
  assert.strictEqual(findListenerPid(NETSTAT, 2013), null);
});

test("findListenerPid tolerates empty or garbage output", () => {
  assert.strictEqual(findListenerPid("", 20128), null);
  assert.strictEqual(findListenerPid("LISTENING\n", 20128), null);
  assert.strictEqual(findListenerPid(undefined, 20128), null);
});

test("buildTrayArgs forwards host and port", () => {
  assert.deepStrictEqual(buildTrayArgs({ host: "127.0.0.1", port: 20129 }), [
    "--tray",
    "--skip-update",
    "-H",
    "127.0.0.1",
    "-p",
    "20129",
  ]);
});

test("buildTrayArgs falls back to the launcher defaults", () => {
  assert.deepStrictEqual(buildTrayArgs(), ["--tray", "--skip-update", "-H", "0.0.0.0", "-p", "20128"]);
});
