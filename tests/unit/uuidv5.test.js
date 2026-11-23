import { describe, it, expect } from "bun:test";
import { uuidv5, UUID_NS_DNS } from "../../open-sse/utils/uuidv5.js";
import { generateSessionId } from "../../open-sse/utils/cursorChecksum.js";

describe("uuidv5", () => {
  it("matches uuid@13 v5 for the DNS namespace", () => {
    expect(UUID_NS_DNS).toBe("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
    expect(uuidv5("www.example.com", UUID_NS_DNS)).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
    expect(uuidv5("", UUID_NS_DNS)).toBe("4ebd0208-8328-5d69-8c44-ec50939c0967");
    expect(uuidv5("pässwörd-日本語-🔐", UUID_NS_DNS)).toBe("9876e541-8694-5558-835d-f87c4240190f");
  });

  it("defaults the namespace to DNS", () => {
    expect(uuidv5("www.example.com")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("cursorChecksum session id is unchanged", () => {
    expect(generateSessionId("tok_abc123XYZ")).toBe("17f24873-878b-53d8-8169-85634257ae98");
  });
});
