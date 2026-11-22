import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const script = readFileSync(new URL("../../scripts/post-deploy.sh", import.meta.url), "utf8");
const repository = "ghcr.io/raufimusaddiq/literouter-production";
const tag = (letter) => `production-${letter.repeat(40)}`;
const id = (letter) => `sha256:${letter.repeat(64)}`;
const image = (letter) => `${repository}:${tag(letter)}`;
const row = (letter) => `${image(letter)} ${id(letter)}`;

// Every Docker/curl invocation is a shell function. Unknown calls fail closed.
const mock = `
docker() {
  if [ "\${TEST_FAIL:-}" = "$1 $2" ]; then return 91; fi
  case "$1 $2" in
    'image ls') printf '%s\\n' "$TEST_IMAGES" ;;
    'image inspect')
      while read -r ref value; do
        if [ "$ref" = "$3" ]; then
          if [ "\${TEST_CHANGED_REFERENCE:-}" = "$ref" ]; then value="$TEST_CHANGED_ID"; fi
          printf '%s\\n' "$value"; return 0
        fi
      done <<< "$TEST_IMAGES"
      return 1 ;;
    'container ls')
      [ "$3 $4" = '--all --quiet' ] || return 93
      printf '%s\\n' "$TEST_CONTAINERS"
      [ "\${TEST_PARTIAL_INVENTORY_FAIL:-}" != true ] || return 94 ;;
    'container inspect')
      if [ "$3" = literouter ]; then
        if [ "\${removed:-false}" = true ] && [ -n "\${TEST_LATE_STATE:-}" ]; then
          printf '%s\\n' "$TEST_LATE_STATE"
        else
          printf '%s\\n' "$TEST_STATE"
        fi
      else
        [ "\${TEST_FAIL_REFERENCES:-}" != true ] || return 92
        printf '%s\\n' "$TEST_REFERENCES"
        if [ "\${removed:-false}" = true ]; then printf '%s\\n' "\${TEST_LATE_REFERENCE:-}"; fi
      fi ;;
    'image rm')
      [ "$#" -eq 3 ] || return 93
      printf 'removed %s\\n' "$3"
      removed=true ;;
    *) return 99 ;;
  esac
}
curl() { [ "\${TEST_FAIL:-}" != curl ]; }
`;

function run(overrides = {}, args = ["--apply"]) {
  return spawnSync("bash", ["-c", `${mock}\n${script}`, "retention-test", ...args], {
    env: {
      ...process.env,
      DOCKER_BIN: "docker",
      LITEROUTER_PRODUCTION_TAG: tag("a"),
      LITEROUTER_PREVIOUS_PRODUCTION_TAG: tag("b"),
      TEST_IMAGES: [row("c"), row("d"), row("b"), row("a")].join("\n"),
      TEST_CONTAINERS: "running\nstopped",
      TEST_STATE: `${image("a")} ${id("a")} true healthy`,
      TEST_REFERENCES: row("a"),
      ...overrides,
    },
    encoding: "utf8",
    timeout: 4000,
  });
}

function removed(result) {
  expect(result.error).toBeUndefined();
  return [...result.stdout.matchAll(/^removed (.+)$/gm)].map((match) => match[1]);
}

it("keeps N=2 releases after successive deploys, regardless of image-list order", () => {
  let rows = [row("a"), row("b"), row("c"), row("d")];
  for (const [current, previous] of [["a", "b"], ["e", "a"], ["f", "e"]]) {
    if (!rows.includes(row(current))) rows.unshift(row(current));
    const result = run({
      LITEROUTER_PRODUCTION_TAG: tag(current),
      LITEROUTER_PREVIOUS_PRODUCTION_TAG: tag(previous),
      TEST_STATE: `${image(current)} ${id(current)} true healthy`,
      TEST_REFERENCES: row(current),
      TEST_IMAGES: rows.join("\n"),
    });
    expect(result.status, result.stderr).toBe(0);
    const deleted = removed(result);
    expect(deleted).not.toContain(image(current));
    expect(deleted).not.toContain(image(previous));
    rows = rows.filter((value) => !deleted.includes(value.split(" ")[0]));
    expect(rows.sort()).toEqual([row(current), row(previous)].sort());
  }
});

it("preserves stopped-container tags and all aliases of container-referenced IDs", () => {
  const result = run({ TEST_REFERENCES: `${row("a")}\n${row("c")}\nother-repository@sha256:digest ${id("d")}` });
  expect(result.status, result.stderr).toBe(0);
  expect(removed(result)).toEqual([]);
  expect(result.stdout).toContain(`keep container reference ${image("c")}`);
  expect(result.stdout).toContain(`keep container reference ${image("d")}`);
});

it("protects exact container tag references even when their image ID differs", () => {
  const result = run({ TEST_REFERENCES: `${row("a")}\n${image("c")} ${id("e")}` });
  expect(result.status, result.stderr).toBe(0);
  expect(removed(result)).toEqual([image("d")]);
});

it("rechecks container references between removals", () => {
  const result = run({ TEST_LATE_REFERENCE: `new-container-alias ${id("d")}` });
  expect(result.status, result.stderr).toBe(0);
  expect(removed(result)).toEqual([image("c")]);
  expect(result.stdout).toContain(`keep container reference ${image("d")}`);
});

it("stops if deployment changes or a candidate is retagged during cleanup", () => {
  const changedDeployment = run({ TEST_LATE_STATE: `${image("d")} ${id("d")} true healthy` });
  expect(changedDeployment.status).not.toBe(0);
  expect(removed(changedDeployment)).toEqual([image("c")]);
  const changedImage = run({ TEST_CHANGED_REFERENCE: image("c"), TEST_CHANGED_ID: id("e") });
  expect(changedImage.status).not.toBe(0);
  expect(removed(changedImage)).toEqual([]);
});

it("defaults to a read-only manifest; ignores unrelated and non-full-SHA tags", () => {
  const result = run({ TEST_IMAGES: `${row("c")}\n${row("b")}\n${row("a")}\n${repository}:latest ${id("d")}\n${repository}:production-invalid ${id("d")}\nother:${tag("d")} ${id("d")}` }, []);
  expect(result.status, result.stderr).toBe(0);
  expect(removed(result)).toEqual([]);
  expect(result.stdout.match(/^would remove .+$/gm)).toEqual([`would remove ${image("c")}`]);
});

it("fails closed on missing/invalid releases, unhealthy or wrong running image, and inventory failures", () => {
  for (const overrides of [
    { LITEROUTER_PRODUCTION_TAG: "" },
    { LITEROUTER_PRODUCTION_TAG: "latest" },
    { LITEROUTER_PREVIOUS_PRODUCTION_TAG: "" },
    { LITEROUTER_PREVIOUS_PRODUCTION_TAG: "production-invalid" },
    { TEST_IMAGES: `${row("a")}\n${row("c")}` },
    { TEST_STATE: `${image("a")} ${id("a")} true unhealthy` },
    { TEST_STATE: `${image("c")} ${id("c")} true healthy` },
    { TEST_STATE: `${image("a")} ${id("c")} true healthy` },
    { TEST_CONTAINERS: "" },
    { TEST_REFERENCES: "" },
    { TEST_REFERENCES: row("c") },
    { TEST_REFERENCES: `${row("a")}\ncontainer invalid-id` },
    { TEST_PARTIAL_INVENTORY_FAIL: "true" },
    { TEST_FAIL: "image ls" },
    { TEST_FAIL: "image inspect" },
    { TEST_FAIL: "container ls" },
    { TEST_FAIL: "container inspect" },
    { TEST_FAIL_REFERENCES: "true" },
    { TEST_FAIL: "curl" },
    { TEST_IMAGES: `${image("c")} invalid-id\n${row("b")}\n${row("a")}` },
  ]) {
    const result = run(overrides);
    expect(result.status, JSON.stringify(overrides)).not.toBe(0);
    expect(removed(result)).toEqual([]);
  }
});

it("requires both env values; explicit none skips without invoking Docker in either mode", () => {
  for (const name of ["LITEROUTER_PRODUCTION_TAG", "LITEROUTER_PREVIOUS_PRODUCTION_TAG"]) {
    for (const value of [undefined, ""]) {
      const result = run({ [name]: value, DOCKER_BIN: "must-not-run-docker" }, []);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`set ${name}`);
      expect(result.stderr).not.toContain("command not found");
      expect(removed(result)).toEqual([]);
    }
  }
  for (const args of [[], ["--apply"]]) {
    const result = run({ LITEROUTER_PREVIOUS_PRODUCTION_TAG: "none", DOCKER_BIN: "must-not-run-docker", TEST_FAIL: "curl" }, args);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("no previous deployed tag; skipping image cleanup");
    expect(removed(result)).toEqual([]);
    expect(result.stdout).not.toContain("would remove");
    expect(result.stderr).toBe("");
  }
  for (const current of ["none", "latest", "production-invalid"]) {
    const result = run({ LITEROUTER_PRODUCTION_TAG: current, LITEROUTER_PREVIOUS_PRODUCTION_TAG: "none" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid production tag");
    expect(removed(result)).toEqual([]);
  }
});

it("skips same-tag deploys; rejects unexpected arguments; stops on removal failure", () => {
  const same = run({ LITEROUTER_PREVIOUS_PRODUCTION_TAG: tag("a") });
  expect(same.status, same.stderr).toBe(0);
  expect(removed(same)).toEqual([]);
  for (const args of [["--force"], ["--apply", "extra"]]) {
    const result = run({}, args);
    expect(result.status).toBe(2);
    expect(removed(result)).toEqual([]);
  }
  const failed = run({ TEST_FAIL: "image rm" });
  expect(failed.status).toBe(91);
  expect(removed(failed)).toEqual([]);
});
