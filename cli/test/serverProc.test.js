const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  parseNetstatListeners,
  findListenerPid,
  buildTrayArgs,
  writeServerPid,
  readServerPid,
  clearServerPid,
  isTrackedServerAlive,
} = require("../src/cli/utils/serverProc");

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

test("stale pidfile after a reboot is not treated as our server", () => {
  // Recorded PID 4321 still exists in the OS, but the listener on the
  // recorded port is a different process (or nobody): not ours to kill.
  assert.strictEqual(isTrackedServerAlive(4321, 9999), false);
  assert.strictEqual(isTrackedServerAlive(4321, null), false);
  // Live case: recorded PID is exactly the listener on that port.
  assert.strictEqual(isTrackedServerAlive(4321, 4321), true);
  // Junk never authorizes a kill.
  assert.strictEqual(isTrackedServerAlive(null, 4321), false);
  assert.strictEqual(isTrackedServerAlive(0, 0), false);
  assert.strictEqual(isTrackedServerAlive("abc", "abc"), false);
});

test("pidfile round-trips the port and tolerates the legacy bare-pid format", () => {
  const prev = process.env.DATA_DIR;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "9router-pid-"));
  try {
    writeServerPid(4321, 20128);
    assert.deepStrictEqual(
      { pid: readServerPid().pid, port: readServerPid().port },
      { pid: 4321, port: 20128 }
    );

    fs.writeFileSync(require("../src/cli/utils/serverProc").getPidFile(), "777\n");
    assert.deepStrictEqual(readServerPid(), { pid: 777, port: null });

    fs.writeFileSync(require("../src/cli/utils/serverProc").getPidFile(), "{not json");
    assert.strictEqual(readServerPid(), null);

    clearServerPid();
    assert.strictEqual(readServerPid(), null);
  } finally {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
  }
});
