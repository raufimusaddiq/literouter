import { describe, it, expect } from "vitest";
import { getAccountLabel, getProviderLabel, isEmail, isRawId, maskEmail } from "@/shared/utils/providerLabels";

const UID = "openai-compatible-chat-6d0ab93c-cc80-4278-b1dc-f2da26f80fc6";

describe("providerLabels", () => {
  it("detects emails and raw ids", () => {
    expect(isEmail("a@b.co")).toBe(true);
    expect(isEmail("OpenAI · prod")).toBe(false);
    expect(isRawId(UID)).toBe(true);
    expect(isRawId("6d0ab93c-cc80-4278-b1dc-f2da26f80fc6")).toBe(true);
    expect(isRawId("openai")).toBe(false);
  });
  it("masks emails", () => {
    expect(maskEmail("raufimusaddiq@gmail.com")).toBe("rau…@gmail.com");
    expect(maskEmail("ab@x.io")).toBe("ab…@x.io");
  });
  it("resolves provider names: registry, custom node, unknown", () => {
    expect(getProviderLabel("openai")).toBe("OpenAI");
    expect(getProviderLabel(UID, [{ id: UID, name: "Sumopod" }])).toBe("Sumopod");
    expect(getProviderLabel(UID, [])).toBe("Custom provider");
    expect(getProviderLabel("some-unknown")).toBe("some-unknown");
    expect(getProviderLabel(undefined)).toBe("Unknown provider");
  });
  it("account label: name, masked email, default", () => {
    expect(getAccountLabel({ name: "Prod key" }, "OpenAI")).toBe("Prod key");
    expect(getAccountLabel({ name: "raufimusaddiq@gmail.com" })).toBe("rau…@gmail.com");
    expect(getAccountLabel({ name: UID, email: "a.b@c.com" })).toBe("a.b…@c.com");
    expect(getAccountLabel({ name: UID })).toBe("default");
    expect(getAccountLabel({ name: "Sumopod" }, "Sumopod")).toBe("default");
    expect(getAccountLabel({})).toBe("default");
  });
});
