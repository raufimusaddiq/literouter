import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";

const script = new URL("../../scripts/deploy.sh", import.meta.url).pathname;
const repository = "ghcr.io/raufimusaddiq/literouter-production";
const sha = (letter) => letter.repeat(40);
const tag = (letter) => `production-${sha(letter)}`;
const image = (letter) => `${repository}:${tag(letter)}`;

// Synthetic docker/curl only: no real container, image or tag is touched. Every
// invocation is recorded so the test can assert on exactly what was removed.
const docker = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TEST_LOG"
case "$1" in
  container)
    case "$5" in
      '{{.Config.Image}}')
        [ -n "\${TEST_RUNNING:-}" ] || exit 1
        printf '%s\\n' "$TEST_RUNNING" ;;
      '{{.State.Health.Status}}')
        printf '%s\\n' "\${TEST_HEALTH:-healthy}" ;;
      *) exit 93 ;;
    esac ;;
  compose) exit "\${TEST_COMPOSE_EXIT:-0}" ;;
  image)
    [ "$2" = rm ] || exit 94
    printf 'REMOVED %s\\n' "$3" >> "$TEST_LOG"
    exit "\${TEST_RM_EXIT:-0}" ;;
  *) exit 99 ;;
esac
`;

const dir = mkdtempSync(join(tmpdir(), "deploy-sh-test."));
writeFileSync(join(dir, "docker"), docker);
chmodSync(join(dir, "docker"), 0o755);
writeFileSync(join(dir, "curl"), '#!/usr/bin/env bash\nprintf \'curl %s\\n\' "$*" >> "$TEST_LOG"\nexit "${TEST_CURL_EXIT:-0}"\n');
chmodSync(join(dir, "curl"), 0o755);

const log = join(dir, "calls.log");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run({ args, running = image("a"), health = "healthy", curlExit = 0, ...rest } = {}) {
  writeFileSync(log, "");
  const result = spawnSync("bash", [script, ...(args ?? [tag("b")])], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      TEST_LOG: log,
      TEST_RUNNING: running,
      TEST_HEALTH: health,
      TEST_CURL_EXIT: String(curlExit),
      ...rest,
    },
    encoding: "utf8",
    timeout: 5000,
  });
  return { ...result, calls: readFileSync(log, "utf8") };
}

const removed = (result) => [...result.calls.matchAll(/^REMOVED (.+)$/gm)].map((m) => m[1]);

it("removes exactly the replaced tag after health and the endpoint pass", () => {
  const result = run({ args: [sha("b")], running: image("a") });

  expect(result.status, result.stderr).toBe(0);
  expect(removed(result)).toEqual([image("a")]);
  // The new tag is deployed, never removed.
  expect(removed(result)).not.toContain(image("b"));
  expect(result.calls).toContain("compose");
});

it("keeps the previous tag when the container is not healthy", () => {
  // The dangerous regression: removing the old tag before verifying would leave
  // a failed deploy with nothing to roll back to.
  const result = run({ args: [sha("b")], running: image("a"), health: "starting" });

  expect(result.status).not.toBe(0);
  expect(removed(result)).toEqual([]);
  expect(result.stderr).toContain("not healthy");
  expect(result.stderr).toContain("rollback");
});

it("keeps the previous tag when the public endpoint does not answer", () => {
  const result = run({ args: [sha("b")], running: image("a"), curlExit: 22 });

  expect(result.status).not.toBe(0);
  expect(removed(result)).toEqual([]);
  expect(result.stderr).toContain("did not answer");
});

it("removes nothing when the same tag is redeployed", () => {
  const result = run({ args: [sha("a")], running: image("a") });

  expect(result.status, result.stderr).toBe(0);
  expect(removed(result)).toEqual([]);
  expect(result.stdout).toContain("nothing to remove");
});

it("refuses a missing, short or malformed SHA without touching docker", () => {
  for (const args of [[], [sha("a").slice(0, 12)], ["latest"], [tag("b")]]) {
    const result = run({ args });
    expect(result.status, `args=${JSON.stringify(args)}`).toBe(2);
    expect(result.stderr).toContain("usage");
    expect(result.calls).toBe("");
  }
});

it("aborts without deploying when the running tag cannot be determined", () => {
  // Missing container.
  const missing = run({ args: [sha("b")], running: "" });
  expect(missing.status).toBe(1);
  expect(missing.stderr).toContain("cannot inspect");
  expect(missing.calls).not.toContain("compose");
  expect(removed(missing)).toEqual([]);

  // Right repository, wrong tag shape: never guessed into a removal.
  const wrongTag = run({ args: [sha("b")], running: `${repository}:latest` });
  expect(wrongTag.status).toBe(1);
  expect(wrongTag.stderr).toContain("unexpected tag");
  expect(wrongTag.calls).not.toContain("compose");
  expect(removed(wrongTag)).toEqual([]);

  // A foreign repository is never deployed over or pruned.
  const foreign = run({ args: [sha("b")], running: "ghcr.io/raufimusaddiq/richmod-web:sha-abc" });
  expect(foreign.status).toBe(1);
  expect(foreign.stderr).toContain("not on");
  expect(removed(foreign)).toEqual([]);
});

it("leaves the old tag alone when the deploy itself fails", () => {
  const result = run({ args: [sha("b")], running: image("a"), TEST_COMPOSE_EXIT: "1" });

  expect(result.status).not.toBe(0);
  expect(removed(result)).toEqual([]);
});
