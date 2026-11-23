import { describe, it, expect, afterEach } from "bun:test";
import { getBoot } from "../../src/web/boot.js";

const defaultZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

const hadWindow = "window" in globalThis;
const originalWindow = globalThis.window;

function setBoot(value) {
  globalThis.window = value === undefined ? {} : { __LR_BOOT__: value };
}

afterEach(() => {
  if (hadWindow) globalThis.window = originalWindow;
  else delete globalThis.window;
});

describe("getBoot", () => {
  it("returns defaults when no boot object exists", () => {
    setBoot(undefined);
    expect(getBoot()).toEqual({ timeZone: defaultZone, gaId: null, requireLogin: true, locale: "en" });
  });

  it("returns defaults when there is no window at all", () => {
    delete globalThis.window;
    expect(getBoot()).toEqual({ timeZone: defaultZone, gaId: null, requireLogin: true, locale: "en" });
  });

  it("merges a partial object", () => {
    setBoot({ timeZone: "Asia/Jakarta", requireLogin: false });
    expect(getBoot()).toEqual({ timeZone: "Asia/Jakarta", gaId: null, requireLogin: false, locale: "en" });
    setBoot({ gaId: "G-ABC123", locale: "id" });
    expect(getBoot()).toEqual({ timeZone: defaultZone, gaId: "G-ABC123", requireLogin: true, locale: "id" });
  });

  it("falls back on invalid zones and wrong types", () => {
    setBoot({ timeZone: "Mars/Phobos", requireLogin: "yes", gaId: 5, locale: 7 });
    expect(getBoot()).toEqual({ timeZone: defaultZone, gaId: null, requireLogin: true, locale: "en" });
  });

  it("reads window.__LR_BOOT__ on each call", () => {
    setBoot({ locale: "id" });
    expect(getBoot().locale).toBe("id");
    setBoot({ locale: "en" });
    expect(getBoot().locale).toBe("en");
  });

  it("passes script-breaking text through unchanged", () => {
    const hostile = "</script><!--";
    setBoot({ gaId: hostile, locale: hostile });
    const boot = getBoot();
    expect(boot.gaId).toBe(hostile);
    expect(boot.locale).toBe(hostile);
  });
});
