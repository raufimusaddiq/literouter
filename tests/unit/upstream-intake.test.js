import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

const { createBroker, createBridge } = createRequire(import.meta.url)("../../scripts/upstream-intake-proxy.cjs");

const script = readFileSync(new URL("../../scripts/upstream-intake.sh", import.meta.url), "utf8");
const helpers = script.slice(script.indexOf("log()"), script.indexOf("trap cleanup EXIT"));
const head = "a".repeat(40);
const merged = "b".repeat(40);
const approved = {
  headRefOid: head,
  mergeStateStatus: "CLEAN",
  statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
  reviews: [{ author: { login: "personal-code-reviewer" }, commit: { oid: head }, state: "APPROVED" }],
};

function run(body, data = approved) {
  const dir = mkdtempSync(join(tmpdir(), "worktree."));
  const file = join(dir, "run.sh");
  writeFileSync(file, `set -euo pipefail\n${helpers}\nLOG_PREFIX=test\nREPO=/repo\nTARGET=origin-literouter\n${body}\n`);
  try {
    return spawnSync("bash", [file], {
      env: { ...process.env, PR_DATA: JSON.stringify(data), MERGED: merged, TEST_WORKTREE: dir, TEST_WORK_ROOT: tmpdir() },
      encoding: "utf8",
      timeout: 4000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}


const mockView = `
gh() { printf '%s\\n' "$PR_DATA"; }
sleep() { exit 77; }
wait_for_gates 75
`;

describe("upstream intake shell lifecycle", () => {
  it("accepts green checks and current-head Hermes approval", () => {
    expect(run(mockView).status).toBe(0);
  });

  it("waits for checks, current-head approval, and the actual Hermes reviewer", () => {
    for (const data of [
      { ...approved, statusCheckRollup: [] },
      { ...approved, statusCheckRollup: [{ status: "IN_PROGRESS", conclusion: "" }] },
      { ...approved, reviews: [{ ...approved.reviews[0], commit: { oid: merged } }] },
      { ...approved, reviews: [{ ...approved.reviews[0], author: { login: "someone-else" } }] },
    ]) expect(run(mockView, data).status).toBe(77);
  });

  it("repairs completed blockers, but waits until pending reviews finish", () => {
    expect(run(mockView, { ...approved, statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }] }).status).toBe(2);
    expect(run(mockView, { ...approved, reviews: [{ ...approved.reviews[0], state: "CHANGES_REQUESTED" }] }).status).toBe(2);
    expect(run(mockView, { ...approved, statusCheckRollup: [
      { status: "COMPLETED", conclusion: "FAILURE" }, { status: "IN_PROGRESS", conclusion: "" },
    ] }).status).toBe(77);
    expect(run("gh() { return 1; }; wait_for_gates 75").status).toBe(1);
  });

  it("pulls the merged SHA, never the PR head, after checking host health", () => {
    const result = run(`
gh() { case "$1 $2" in
  "pr merge") echo "merge $*";;
  "pr view") echo "$MERGED";;
  "run list") echo '123 completed success';;
  *) return 1;; esac; }
git() { return 0; }
check_host_health() { echo host-gate; }
docker() { case "$1" in
  pull) echo "$*";;
  compose) echo "tag=$LITEROUTER_PRODUCTION_TAG";;
  inspect) if [[ "$*" = *State.Health* ]]; then echo healthy;
    else echo "image:production-$MERGED"; fi;; esac; }
curl() { return 0; }
deploy_main '${head}' 75
`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`--match-head-commit ${head}`);
    expect(result.stdout).toContain(`host-gate\npull ghcr.io/raufimusaddiq/literouter-production:production-${merged}`);
    expect(result.stdout).toContain(`tag=production-${merged}`);
  });

  it("keeps failed workspaces, removes only the successful run worktree", () => {
    const body = `DEPLOY=true\nWORK_ROOT="$TEST_WORK_ROOT"\nWORKTREE="$TEST_WORKTREE"\nrm() { echo "removed $*"; }\ntrap cleanup EXIT\n`;
    const failed = run(`${body}false`);
    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain("retaining workspace");
    expect(failed.stdout).not.toContain("removed -rf");
    const success = run(`${body}true`);
    expect(success.status).toBe(0);
    expect(success.stdout).toContain("removed -rf -- ");
    expect(script).not.toContain('rm -rf "$WORK_ROOT"');
  });

  it("lists all commits without a pipefail SIGPIPE and uses ephemeral yolo", () => {
    expect(script).not.toContain("| head -50");
    expect(script).toContain('codex_sandbox exec --yolo --ephemeral --cd "$WORKTREE"');
    expect(script).toContain('fetch --quiet "$TARGET" "$BASE_BRANCH"');
    expect(script).toContain("--clearenv");
    expect(script).toContain("--tmpfs /tmp --dir /tmp/.codex");
    expect(script).toContain("--setenv PATH /opt/node:/usr/bin:/bin");
    expect(script).toContain('--ro-bind "$NODE_BIN" /opt/node/node');
    expect(script).toContain('git clone --no-hardlinks --no-checkout "$REPO" "$WORKTREE"');
    expect(script).not.toContain("--ro-bind /etc /etc");
    expect(script).not.toContain('worktree add --detach');
    expect(script).not.toContain("--share-net");
    expect(script).not.toContain("--setenv ROUTER_API_KEY");
    expect(script).toContain("GitHub CI owns validation");
    expect(script).toContain('HOST_HEALTH=$(check_host_health)');
  });
});

// CI-only loopback fixtures: no provider calls or production credentials.
it("brokers only Codex inference, hides the credential, streams through the Unix bridge", async () => {
  const dir = mkdtempSync(join(tmpdir(), "intake-proxy-test-"));
  const calls = [];
  const upstream = createServer((req, res) => {
    calls.push({ path: req.url, auth: req.headers.authorization });
    req.resume();
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"ok":true}\n\n');
    res.end("data: [DONE]\n\n");
  });
  let broker, bridge;
  async function close(server) {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
  }
  try {
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    broker = createBroker("host-only-key", `http://127.0.0.1:${upstream.address().port}`);
    const socket = join(dir, "model.sock");
    broker.listen(socket);
    await once(broker, "listening");
    bridge = createBridge(socket);
    bridge.listen(0, "127.0.0.1");
    await once(bridge, "listening");
    const call = (path, body, method = "POST") => new Promise((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port: bridge.address().port, path, method,
        headers: { authorization: "Bearer untrusted-client-key" } }, (res) => {
        let output = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { output += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: output }));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end(body);
    });
    for (const [path, body, method] of [
      ["/api/providers", '{"model":"codex"}', "POST"],
      ["/v1/responses?target=external", '{"model":"codex"}', "POST"],
      ["/v1/responses", '{"model":"another-model"}', "POST"],
      ["/v1/responses", '{"model":"codex"}', "GET"],
    ]) expect((await call(path, body, method)).status).toBe(403);
    expect((await call("/v1/responses", "invalid-json")).status).toBe(400);
    expect(calls).toEqual([]);
    const result = await call("/v1/responses", '{"model":"codex","input":"hello"}');
    expect(result.status).toBe(200);
    expect(result.body).toContain("data: [DONE]");
    expect(result.body).not.toContain("host-only-key");
    expect(calls).toEqual([{ path: "/v1/responses", auth: "Bearer host-only-key" }]);
  } finally {
    await close(bridge);
    await close(broker);
    await close(upstream);
    rmSync(dir, { recursive: true, force: true });
  }
});
