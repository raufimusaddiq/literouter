import { describe, expect, test } from "bun:test";

const {
  parseProcNetTcp,
  parseSsListeners,
  findPidByInodes,
  getListenerPid,
} = require("../src/cli/utils/listener");

const PROC_TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:4EA0 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 123456 1 ffff9d1a8c3a0000 100 0 0 10 0
   1: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 555 1 ffff9d1a8c3a1111 100 0 0 10 0
   2: 0100007F:4EA0 0100007F:C000 01 00000000:00000000 00:00000000 00000000     0        0 777 1 ffff9d1a8c3a2222 20 4 30 10 -1
   3: 0100007F:4EA1 00000000:0000 06 00000000:00000000 00:00000000 00000000     0        0 888 1 ffff9d1a8c3a3333 20 4 30 10 -1
`;

const PROC_TCP6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000000000000:4EA0 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 999111 1 ffff9d1a8c3a4444 100 0 0 10 0
`;

const SS_OUT = `State  Recv-Q Send-Q Local Address:Port Peer Address:PortProcess
LISTEN 0      511          0.0.0.0:20128      0.0.0.0:*    users:(("next-server (v1",pid=8096,fd=19))
LISTEN 0      511             [::]:3000         [::]:*    users:(("node",pid=77,fd=20))
LISTEN 0      4096       127.0.0.1:5432      0.0.0.0:*
`;

describe("parseProcNetTcp", () => {
  test("returns the inodes of LISTEN sockets on the port only", () => {
    expect(parseProcNetTcp(PROC_TCP, 20128)).toEqual(["123456"]);
    expect(parseProcNetTcp(PROC_TCP, 8080)).toEqual(["555"]);
  });

  test("reads ipv6 tables", () => {
    expect(parseProcNetTcp(PROC_TCP6, 20128)).toEqual(["999111"]);
  });

  test("ignores empty and malformed input", () => {
    expect(parseProcNetTcp("", 20128)).toEqual([]);
    expect(parseProcNetTcp("garbage\nmore garbage", 20128)).toEqual([]);
    expect(parseProcNetTcp(null, 20128)).toEqual([]);
  });
});

describe("parseSsListeners", () => {
  test("extracts the pid for the port", () => {
    expect(parseSsListeners(SS_OUT, 20128)).toBe(8096);
    expect(parseSsListeners(SS_OUT, 3000)).toBe(77);
  });

  test("returns null for an unknown port or a row without process info", () => {
    expect(parseSsListeners(SS_OUT, 9999)).toBeNull();
    expect(parseSsListeners(SS_OUT, 5432)).toBeNull();
  });
});

describe("findPidByInodes", () => {
  test("maps a socket inode to the owning pid through fd links", () => {
    const links = {
      "/proc/10/fd": ["0", "1"],
      "/proc/10/fd/0": "/dev/null",
      "/proc/10/fd/1": "socket:[42]",
      "/proc/8096/fd": ["3", "19"],
      "/proc/8096/fd/3": "pipe:[1]",
      "/proc/8096/fd/19": "socket:[123456]",
    };
    const deps = {
      listPids: () => ["10", "8096", "self"],
      listDir: (dir) => {
        if (!(dir in links)) throw new Error("EACCES");
        return links[dir];
      },
      readLink: (p) => links[p],
    };
    expect(findPidByInodes(["123456"], deps)).toBe(8096);
    expect(findPidByInodes(["404"], deps)).toBeNull();
    expect(findPidByInodes([], deps)).toBeNull();
  });
});

describe("getListenerPid on linux", () => {
  const procDeps = (extra = {}) => ({
    platform: "linux",
    exec: () => {
      throw new Error("not installed");
    },
    readFile: (file) => {
      if (file === "/proc/net/tcp") return PROC_TCP;
      if (file === "/proc/net/tcp6") return PROC_TCP6;
      throw new Error("ENOENT");
    },
    listPids: () => ["8096"],
    listDir: () => ["19"],
    readLink: () => "socket:[123456]",
    ...extra,
  });

  test("falls back to /proc when neither lsof nor ss exist", () => {
    expect(getListenerPid(20128, procDeps())).toBe(8096);
  });

  test("falls back to /proc when lsof prints nothing", () => {
    const exec = (cmd) => (cmd.startsWith("lsof") ? "" : (() => { throw new Error("no ss"); })());
    expect(getListenerPid(20128, procDeps({ exec }))).toBe(8096);
  });

  test("prefers lsof when it answers", () => {
    const exec = (cmd) => (cmd.startsWith("lsof") ? "4242\n" : "");
    expect(getListenerPid(20128, procDeps({ exec }))).toBe(4242);
  });

  test("uses ss before /proc", () => {
    const exec = (cmd) => {
      if (cmd.startsWith("ss")) return SS_OUT;
      throw new Error("no lsof");
    };
    expect(getListenerPid(20128, procDeps({ exec, readFile: () => { throw new Error("unused"); } }))).toBe(8096);
  });

  test("returns null when nothing listens", () => {
    expect(getListenerPid(31337, procDeps())).toBeNull();
  });

  test("macos only uses lsof", () => {
    const calls = [];
    const exec = (cmd) => {
      calls.push(cmd);
      return "";
    };
    expect(getListenerPid(20128, procDeps({ platform: "darwin", exec }))).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^lsof/);
  });

  test("windows reads netstat", () => {
    const out = "  TCP    0.0.0.0:20128    0.0.0.0:0    LISTENING    4321\r\n";
    expect(getListenerPid(20128, { platform: "win32", exec: () => out })).toBe(4321);
  });
});
