import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..");
const read = (file) => readFileSync(join(root, file), "utf8");

describe("Dockerfile", () => {
  const dockerfile = read("Dockerfile");

  it("has no node or next", () => {
    expect(dockerfile).not.toMatch(/\bnode\b/i);
    expect(dockerfile).not.toMatch(/\bnext\b/i);
    expect(dockerfile).not.toMatch(/custom-server/);
    expect(dockerfile).not.toMatch(/\bnpm\b|\bnpx\b/);
  });

  it("runtime base is alpine with the required packages", () => {
    expect(dockerfile).toContain("ARG ALPINE_IMAGE=alpine:3.22");
    expect(dockerfile).toMatch(/^FROM \$\{ALPINE_IMAGE\} AS runner$/m);
    expect(dockerfile).toMatch(/apk --no-cache add libstdc\+\+ libgcc ca-certificates su-exec/);
  });

  it("user is uid and gid 1000", () => {
    expect(dockerfile).toMatch(/addgroup -g 1000/);
    expect(dockerfile).toMatch(/adduser .*-u 1000/);
  });

  it("keeps the volume and CA contract", () => {
    expect(dockerfile).toContain("/app/data");
    expect(dockerfile).toContain("/app/data-home");
    expect(dockerfile).toContain("PORT=20128");
    expect(dockerfile).toContain("HOSTNAME=0.0.0.0");
    expect(dockerfile).toContain("DATA_DIR=/app/data");
    expect(dockerfile).toContain("NODE_ENV=production");
    expect(dockerfile).toContain("LITEROUTER_SYSTEM_CA=1");
    expect(dockerfile).toContain("ln -sf /app/data-home /root/.9router");
    expect(dockerfile).toContain("su-exec literouter");
    expect(dockerfile).toContain("chown -R literouter:literouter /app/data /app/data-home");
  });

  it("build stage uses the pinned Bun image and both musl targets", () => {
    expect(dockerfile).toMatch(/^ARG BUN_IMAGE=oven\/bun:1\.4\.4-alpine$/m);
    expect(dockerfile).toMatch(/^FROM --platform=\$BUILDPLATFORM \$\{BUN_IMAGE\} AS builder$/m);
    expect(dockerfile).toContain("bun-linux-x64-musl");
    expect(dockerfile).toContain("bun-linux-arm64-musl");
    expect(dockerfile).toContain("bun install --frozen-lockfile");
    expect(dockerfile).toContain("COPY package.json bun.lock ./");
    expect(dockerfile).toMatch(/CMD \["\/app\/literouter"\]/);
    expect(dockerfile).toContain('--compile "$target" --outfile /out/literouter');
    expect(dockerfile).not.toContain("--outdir");
  });
});

describe("compose and deploy files", () => {
  it("compose.production healthcheck uses BUN_BE_BUN and no node", () => {
    const compose = read("compose.production.yml");
    expect(compose).toContain("BUN_BE_BUN=1");
    expect(compose).toContain("/app/literouter");
    expect(compose).not.toMatch(/^\s+- node\s*$/m);
  });

  it("compose.production has no NODE_OPTIONS", () => {
    expect(read("compose.production.yml")).not.toContain("NODE_OPTIONS");
  });

  it("deploy files do not reference node, next or custom-server", () => {
    for (const file of ["docker-compose.yml", "captain-definition", "start.sh", "scripts/deploy.sh", "scripts/post-deploy.sh"]) {
      const text = read(file);
      expect(text, file).not.toMatch(/(^|[\s"'(=])(node|npm|npx)([\s"')]|\.exe|$)/m);
      expect(text, file).not.toMatch(/custom-server/);
      expect(text, file).not.toMatch(/\bnext (start|dev|build)\b/);
    }
  });
});

describe("smoke-image helpers", () => {
  it("names containers with the p4w-smoke prefix and a random suffix", async () => {
    const { containerName } = await import("../../scripts/smoke-image.mjs");
    expect(containerName()).toMatch(/^p4w-smoke-[0-9a-f]{8}$/);
    expect(containerName()).not.toBe(containerName());
  });

  it("finds the server pid under QEMU emulation and ignores exec'd helpers", async () => {
    const { serverPid } = await import("../../scripts/smoke-image.mjs");
    const qemu = "    1 {literouter} /usr/bin/qemu-aarch64 /app/literouter /app/literouter\n   51 ps -o pid=,args=\n";
    expect(serverPid(qemu)).toBe(1);
    const withHealth =
      "   51 /app/literouter -e fetch('http://127.0.0.1:20128/api/health')\n" +
      "   60 /app/literouter /tmp/smoke-server.mjs\n" +
      "    1 {literouter} /usr/bin/qemu-aarch64 /app/literouter /app/literouter\n" +
      "   70 ps -o pid=,args=\n";
    expect(serverPid(withHealth)).toBe(1);
    expect(() => serverPid("   51 /app/literouter -e x\n   70 ps -o pid=,args=\n")).toThrow("not found");
  });

  it("finds the server pid and asserts uid 1000", async () => {
    const { serverPid, assertLiterouterUid } = await import("../../scripts/smoke-image.mjs");
    expect(serverPid("    1 /bin/sleep 1\n    7 /app/literouter\n")).toBe(7);
    expect(() => serverPid("1 sleep 1\n")).toThrow("not found");
    expect(assertLiterouterUid("1000")).toBe(1000);
    expect(() => assertLiterouterUid("0")).toThrow("expected literouter");
  });
});

describe("smoke-image timeouts", () => {
  it("passes a timeout to every docker spawn and reports a hung call clearly", async () => {
    const { runDocker } = await import("../../scripts/smoke-image.mjs");
    const seen = [];
    const hung = (cmd, opts) => {
      seen.push(opts.timeout);
      return { exitCode: null, exitedDueToTimeout: true, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };
    expect(() => runDocker(["exec", "c", "true"], { timeoutMs: 5000 }, hung)).toThrow(/timed out after 5s/);
    expect(seen).toEqual([5000]);
    expect(runDocker(["rm", "-f", "c"], { timeoutMs: 1000, allowFail: true }, hung).code).toBeNull();
  });
});
