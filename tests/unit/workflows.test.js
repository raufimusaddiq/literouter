import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..");
const workflowDir = join(root, ".github", "workflows");
const read = (file) => readFileSync(join(workflowDir, file), "utf8").replace(/\r\n/g, "\n");
const files = [...new Bun.Glob("*.yml").scanSync({ cwd: workflowDir })];

describe("workflows", () => {
  it("no workflow uses setup-node, npm or npx", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const text = read(file);
      expect(text, file).not.toMatch(/setup-node/);
      expect(text, file).not.toMatch(/(^|[\s"'(=])(node|npm|npx)([\s"')]|\.exe|$)/m);
    }
  });

  it("no workflow pins a node version or uses a node image", () => {
    for (const file of files) {
      const text = read(file);
      expect(text, file).not.toMatch(/node-version/);
      expect(text, file).not.toMatch(/\bnode:\d/);
    }
  });

  it("every workflow that builds linux/arm64 sets up QEMU", () => {
    for (const file of files) {
      const text = read(file);
      if (text.includes("linux/arm64")) expect(text, file).toContain("docker/setup-qemu-action@v3");
    }
  });

  it("every test.yml and staging.yml job has a timeout-minutes unless it calls a reusable workflow", () => {
    for (const file of ["test.yml", "staging.yml"]) {
      const text = read(file);
      const jobs = text.split(/^jobs:\n/m)[1].split(/^  (?=[\w-]+:\n)/m).filter(Boolean);
      expect(jobs.length, file).toBeGreaterThan(0);
      for (const job of jobs) {
        if (/^    uses:/m.test(job)) continue;
        expect(job, `${file}: ${job.split("\n")[0]}`).toMatch(/^    timeout-minutes:\s*\d+/m);
      }
    }
  });

  it("test.yml image job declares read-only contents permission", () => {
    const image = read("test.yml").split(/^  image:\n/m)[1];
    expect(image).toMatch(/^    permissions:\n      contents: read\n/m);
  });

  it("every workflow that installs Bun pins 1.4.4", () => {
    for (const file of files) {
      const text = read(file);
      const installs = [...text.matchAll(/oven-sh\/setup-bun@/g)].length;
      const pins = [...text.matchAll(/bun-version:\s*1\.4\.4\s*$/gm)].length;
      expect(pins, file).toBe(installs);
    }
  });

  it("production-image only runs on main and tags production-<sha>", () => {
    const text = read("production-image.yml");
    expect(text).toContain("branches: [main]");
    expect(text).toContain("if: github.ref == 'refs/heads/main'");
    expect(text).toContain("-production");
    expect(text).toContain("${{ env.IMAGE }}:production-${{ github.sha }}");
    expect(text).not.toContain("staging");
  });

  it("docker-publish only runs on v* tags", () => {
    const text = read("docker-publish.yml");
    expect(text).toMatch(/tags:\n\s+- "v\*"/);
    expect(text).not.toMatch(/branches:/);
    expect(text).toContain("platforms: linux/amd64,linux/arm64");
  });

  it("staging pushes only to the -staging repository with staging-<sha> tags", () => {
    const text = read("staging.yml");
    expect(text).toContain("ghcr.io/${{ github.repository }}-staging:staging-${{ github.sha }}");
    expect(text).not.toMatch(/:latest\b|value=latest/);
    expect(text).not.toContain("production");
    expect(text).not.toContain("workflow_dispatch");
    expect(text).toMatch(/on:\n  push:\n    branches: \[staging\]\n/);
    expect(text).toContain("uses: ./.github/workflows/test.yml");
    expect(text).toContain("platforms: linux/amd64,linux/arm64");
  });

  it("staging and the called test workflow never share a concurrency group", () => {
    const staging = read("staging.yml").match(/concurrency:\n\s+group:\s*(.+)/)?.[1];
    const test = read("test.yml").match(/concurrency:\n\s+group:\s*(.+)/)?.[1];
    expect(staging).toBeTruthy();
    expect(test).toBeTruthy();
    expect(staging).not.toBe(test);
  });

  it("test.yml gates image size and the arm64 image", () => {
    const text = read("test.yml");
    expect(text).toContain("workflow_call:");
    expect(text).toMatch(/push:\n    branches: \[main\]/);
    expect(text).toContain("check-image-size.mjs");
    expect(text).toContain("smoke-image.mjs");
    expect(text).toContain("linux/arm64");
    expect(text).toContain("git diff --exit-code -- src/shared/constants/providerIconManifest.js");
    expect(text).toMatch(/working-directory: cli\n\s+run:[\s\S]*bun test/);
    expect(text).toContain("bun scripts/smoke-server.mjs --spawn dist/app");
    expect(text).not.toContain("build:web");
  });

  it("deploy scripts cannot accept a staging tag", () => {
    for (const file of ["scripts/deploy.sh", "scripts/post-deploy.sh"]) {
      const text = readFileSync(join(root, file), "utf8");
      expect(text, file).toContain("literouter-production");
      expect(text, file).toContain("production-[0-9a-f]{40}");
      expect(text, file).not.toContain("staging");
    }
  });
});
