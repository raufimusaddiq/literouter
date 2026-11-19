import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getProviderIconSrc } from "@/shared/utils/providerIcon.js";
import { PROVIDER_ICON_IDS } from "@/shared/constants/providerIconManifest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

describe("dashboard client requests", () => {
  it("does not call usage routes removed in #168", () => {
    const offenders = walk(path.join(root, "src"))
      .filter((f) => !f.includes(`${path.sep}api${path.sep}`))
      .filter((f) => /\/api\/usage\/(history|logs)\b/.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("icon manifest matches public/providers/*.png", () => {
    const files = fs.readdirSync(path.join(root, "public/providers")).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4));
    expect([...PROVIDER_ICON_IDS].sort()).toEqual(files.sort());
  });

  it("resolves icons: known, alias, missing, custom node", () => {
    expect(getProviderIconSrc("openai")).toBe("/providers/openai.png");
    expect(getProviderIconSrc("gitlab-duo")).toBe("/providers/gitlab.png");
    expect(getProviderIconSrc("typesafe")).toBeNull();
    expect(getProviderIconSrc("kenari")).toBeNull();
    expect(getProviderIconSrc("openai-compatible-chat-6d0ab93c-cc80-4278-b1dc-f2da26f80fc6")).toBeNull();
    expect(getProviderIconSrc("anthropic-compatible-x-6d0ab93c-cc80-4278-b1dc-f2da26f80fc6")).toBeNull();
  });
});
