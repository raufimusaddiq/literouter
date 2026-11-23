import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { useSystemCaStore } from "../../src/server/ca.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const preload = fileURLToPath(new URL("./helpers/empty-ca-preload.js", import.meta.url));

describe("useSystemCaStore", () => {
  it("returns the number of system certificates and installs them as the process default", () => {
    const calls = [];
    const n = useSystemCaStore({
      getCACertificates: (t) => (t === "system" ? ["a", "b"] : ["bundled"]),
      setDefaultCACertificates: (c) => calls.push(c),
    });
    expect(n).toBe(2);
    expect(calls).toEqual([["a", "b"]]);
  });

  it("throws when the store is empty", () => {
    const set = () => {
      throw new Error("must not be called");
    };
    expect(() => useSystemCaStore({ getCACertificates: () => [], setDefaultCACertificates: set })).toThrow(/refusing/);
  });

  it("throws when the runtime has no system CA API", () => {
    expect(() => useSystemCaStore({})).toThrow(/tls\.setDefaultCACertificates is unavailable/);
  });

  it("is enabled in the production image", () => {
    expect(readFileSync(join(root, "Dockerfile"), "utf8")).toMatch(/^ENV LITEROUTER_SYSTEM_CA=1$/m);
  });

  it("startServer refuses to start when LITEROUTER_SYSTEM_CA=1 and the store is unavailable", () => {
    const run = Bun.spawnSync(["bun", "--preload", preload, join(root, "src/server/index.js")], {
      cwd: root,
      env: { ...process.env, LITEROUTER_SYSTEM_CA: "1", PORT: "0", HOSTNAME: "127.0.0.1" },
      timeout: 30_000,
    });
    expect(run.exitCode).toBe(1);
    expect(run.stderr.toString()).toMatch(/refusing/);
    expect(run.stdout.toString()).not.toMatch(/listening/);
  });
});
