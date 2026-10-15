import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";

const wrapper = new URL("../../scripts/image-retention.sh", import.meta.url).pathname;
const repository = "ghcr.io/raufimusaddiq/literouter-production";
const tag = (letter) => `production-${letter.repeat(40)}`;
const id = (letter) => `sha256:${letter.repeat(64)}`;
const image = (letter) => `${repository}:${tag(letter)}`;
const row = (letter) => `${image(letter)} ${id(letter)}`;

// Synthetic docker/curl only; every call the wrapper or post-deploy.sh makes is
// answered here and anything unknown fails closed. Nothing here touches a real
// container, image or tag.
const docker = `#!/usr/bin/env bash
case "$1 $2" in
  'image ls') printf '%s\\n' "$TEST_IMAGES" ;;
  'image inspect')
    while read -r ref value; do
      if [ "$ref" = "$3" ]; then printf '%s\\n' "$value"; exit 0; fi
    done <<< "$TEST_IMAGES"
    exit 1 ;;
  'container ls')
    [ "$3 $4" = '--all --quiet' ] || exit 93
    printf '%s\\n' "$TEST_CONTAINERS" ;;
  'container inspect')
    if [ "$3" = "\${TEST_CONTAINER_NAME:-literouter}" ]; then
      printf '%s\\n' "$TEST_STATE"
    else
      printf '%s\\n' "$TEST_REFERENCES"
    fi ;;
  'image rm') printf 'removed %s\\n' "$3" ;;
  *) exit 99 ;;
esac
`;

const dir = mkdtempSync(join(tmpdir(), "image-retention-test."));
writeFileSync(join(dir, "docker"), docker);
chmodSync(join(dir, "docker"), 0o755);
writeFileSync(join(dir, "curl"), "#!/usr/bin/env bash\nexit 0\n");
chmodSync(join(dir, "curl"), 0o755);

const stateFile = join(dir, "state");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The tag this unit last observed running, as a previous run would have left it. */
function seedState(current, previous) {
  writeFileSync(stateFile, `current=${tag(current)}\nprevious=${previous === "none" ? "none" : tag(previous)}\n`);
}

/**
 * Drive the real wrapper against the synthetic docker. `running` is the tag the
 * live container is on; `images` are the local production tags.
 */
function run({ running, images, apply = false, state, ...rest } = {}) {
  return spawnSync("bash", [wrapper], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      LITEROUTER_STATE_FILE: stateFile,
      LITEROUTER_APPLY: apply ? "true" : "false",
      TEST_STATE: state ?? `${image(running)} ${id(running)} true healthy`,
      TEST_IMAGES: images.map(row).join("\n"),
      TEST_CONTAINERS: "running",
      TEST_REFERENCES: row(running),
      ...rest,
    },
    encoding: "utf8",
    timeout: 5000,
  });
}

const removed = (result) => [...result.stdout.matchAll(/^removed (.+)$/gm)].map((m) => m[1]);
const wouldRemove = (result) => [...result.stdout.matchAll(/^would remove (.+)$/gm)].map((m) => m[1]);
const readState = () => readFileSync(stateFile, "utf8");

it("derives the running tag from the live container, not from image age", () => {
  // The container runs 'b' even though 'a' is newer and listed first.
  const result = run({ running: "b", images: ["a", "b"] });

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain(`current=${tag("b")}`);
  expect(readState()).toBe(`current=${tag("b")}\nprevious=none\n`);
});

it("records the running tag as the rollback tag on the next deploy", () => {
  seedState("a", "none");
  // The container moves to 'e'; 'a' must become the rollback tag, not a candidate.
  const result = run({ running: "e", images: ["e", "a", "b"] });

  expect(result.status, result.stderr).toBe(0);
  expect(readState()).toBe(`current=${tag("e")}\nprevious=${tag("a")}\n`);
  expect(result.stdout).toContain(`keep release ${image("a")}`);
  expect(wouldRemove(result)).toEqual([image("b")]);
});

it("treats a rollback as a deploy, not as an older image to prune", () => {
  seedState("e", "a");
  // The container goes back to 'a'; 'e' must become the rollback tag.
  const result = run({ running: "a", images: ["e", "a"] });

  expect(result.status, result.stderr).toBe(0);
  expect(readState()).toBe(`current=${tag("a")}\nprevious=${tag("e")}\n`);
  expect(wouldRemove(result)).toEqual([]);
});

it("runs the read-only manifest by default and deletes nothing", () => {
  seedState("a", "e");
  const result = run({ running: "a", images: ["a", "e", "c"], apply: false });

  expect(result.status, result.stderr).toBe(0);
  expect(wouldRemove(result)).toEqual([image("c")]);
  expect(removed(result)).toEqual([]);
});

it("deletes only when deletion was separately approved", () => {
  seedState("a", "e");
  const result = run({ running: "a", images: ["a", "e", "c"], apply: true });

  expect(result.status, result.stderr).toBe(0);
  expect(removed(result)).toEqual([image("c")]);
  // Both releases survive the removal.
  expect(removed(result)).not.toContain(image("a"));
  expect(removed(result)).not.toContain(image("e"));
});

it("refuses to derive tags from an unhealthy or unexpected container", () => {
  const unhealthy = run({ running: "a", images: ["a"], state: `${image("a")} ${id("a")} true starting` });
  expect(unhealthy.status).toBe(1);
  expect(unhealthy.stderr).toContain("not running and healthy");
  expect(removed(unhealthy)).toEqual([]);

  const stopped = run({ running: "a", images: ["a"], state: `${image("a")} ${id("a")} false healthy` });
  expect(stopped.status).toBe(1);
  expect(removed(stopped)).toEqual([]);

  // Right repository, wrong tag shape: never guessed into a retention decision.
  const wrongTag = run({ running: "a", images: ["a"], state: `${repository}:latest ${id("a")} true healthy` });
  expect(wrongTag.status).toBe(1);
  expect(wrongTag.stderr).toContain("unexpected tag");
  expect(removed(wrongTag)).toEqual([]);

  // A foreign repository must not be pruned.
  const foreign = run({ running: "a", images: ["a"], state: `ghcr.io/raufimusaddiq/richmod-web:sha-abc ${id("a")} true healthy` });
  expect(foreign.status).toBe(1);
  expect(foreign.stderr).toContain("does not run");
  expect(removed(foreign)).toEqual([]);
});

it("ignores an unusable recorded state file instead of pruning on it", () => {
  writeFileSync(stateFile, "current=production-not-a-sha\nprevious=production-<sha>\n");
  const result = run({ running: "a", images: ["a", "c"] });

  expect(result.status, result.stderr).toBe(0);
  expect(readState()).toBe(`current=${tag("a")}\nprevious=none\n`);
  expect(removed(result)).toEqual([]);
});
