import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const eslint = new ESLint({ cwd: root });
const severity = (value) => (Array.isArray(value) ? value[0] : value);

async function rulesFor(file) {
  const config = await eslint.calculateConfigForFile(join(root, file));
  return config.rules;
}

describe("eslint flat config", () => {
  it("has no @next rules", async () => {
    const rules = await rulesFor("src/web/main.jsx");
    expect(Object.keys(rules).filter((name) => name.startsWith("@next/"))).toEqual([]);
  });

  it("applies the React Compiler rules as errors to React sources", async () => {
    const rules = await rulesFor("src/web/main.jsx");
    for (const name of [
      "react-hooks/immutability",
      "react-hooks/rules-of-hooks",
      "react-hooks/refs",
      "react-hooks/purity",
      "react-hooks/preserve-manual-memoization",
    ]) {
      expect(severity(rules[name])).toBe(2);
    }
  });

  it("keeps set-state-in-effect as a warning while data loaders set state after fetch", async () => {
    const rules = await rulesFor("src/web/main.jsx");
    expect(severity(rules["react-hooks/set-state-in-effect"])).toBe(1);
  });

  it("leaves the react-hooks rules out of non-React sources", async () => {
    const rules = await rulesFor("tests/server/spa.test.js");
    expect(rules["react-hooks/rules-of-hooks"]).toBeUndefined();
    expect(rules["react-hooks/set-state-in-effect"]).toBeUndefined();
  });

  it("keeps exhaustive-deps as a warning", async () => {
    const rules = await rulesFor("src/web/main.jsx");
    expect(severity(rules["react-hooks/exhaustive-deps"])).toBe(1);
  });

  it("keeps the blocking React rules as errors", async () => {
    const rules = await rulesFor("src/web/main.jsx");
    for (const name of ["react/jsx-key", "react/no-unescaped-entities", "react/jsx-no-undef"]) {
      expect(severity(rules[name])).toBe(2);
    }
  });

  it("does not depend on eslint-config-next", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
    expect(Object.keys(all).filter((name) => name.includes("eslint-config-next"))).toEqual([]);
  });
});
