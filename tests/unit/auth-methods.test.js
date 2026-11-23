import { describe, it, expect } from "bun:test";
import { AUTH_METHODS, WEB_COOKIE_PROVIDERS, getFormAuthMethods } from "@/shared/constants/providers.js";

describe("AUTH_METHODS", () => {
  it("every method has a non-empty label and icon, and ids match keys", () => {
    for (const [key, method] of Object.entries(AUTH_METHODS)) {
      expect(method.id).toBe(key);
      expect(method.label.trim()).not.toBe("");
      expect(method.icon.trim()).not.toBe("");
    }
    expect(AUTH_METHODS.apikey.label).toBe("API key");
    expect(AUTH_METHODS.apikey.icon).toBe("key");
  });
});

describe("getFormAuthMethods", () => {
  it("offers API key (the key-input method) for ordinary providers", () => {
    expect(getFormAuthMethods("").map((m) => m.id)).toEqual(["apikey"]);
    expect(getFormAuthMethods("openai").map((m) => m.id)).toEqual(["apikey"]);
  });

  it("offers cookie for web-cookie providers and never offers OAuth", () => {
    const cookieProvider = Object.keys(WEB_COOKIE_PROVIDERS)[0];
    if (cookieProvider) expect(getFormAuthMethods(cookieProvider).map((m) => m.id)).toEqual(["cookie"]);
    expect(getFormAuthMethods("openai").some((m) => m.id === "oauth")).toBe(false);
  });
});
