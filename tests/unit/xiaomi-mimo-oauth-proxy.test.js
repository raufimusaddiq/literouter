import { describe, it, expect } from "bun:test";
import {
  registerXiaomiMimoSession,
  getXiaomiMimoSessionStatus,
  clearXiaomiMimoSession,
  stopXiaomiMimoProxy,
} from "../../src/lib/oauth/utils/server.js";

const KEY = Buffer.from("x25519-private-key-material");

describe("xiaomi-mimo OAuth session store", () => {
  it("drops pending sessions when the proxy stops", () => {
    registerXiaomiMimoSession({ state: "s1", privateKeyDer: KEY });
    expect(getXiaomiMimoSessionStatus("s1")).not.toBeNull();

    stopXiaomiMimoProxy();

    expect(getXiaomiMimoSessionStatus("s1")).toBeNull();
  });

  it("drops every session, not just the last one", () => {
    registerXiaomiMimoSession({ state: "a", privateKeyDer: KEY });
    registerXiaomiMimoSession({ state: "b", privateKeyDer: KEY });
    registerXiaomiMimoSession({ state: "c", privateKeyDer: KEY });

    stopXiaomiMimoProxy();

    for (const s of ["a", "b", "c"]) {
      expect(getXiaomiMimoSessionStatus(s)).toBeNull();
    }
  });

  it("ignores registrations with a missing state or key", () => {
    expect(registerXiaomiMimoSession({ state: "", privateKeyDer: KEY })).toBe(false);
    expect(registerXiaomiMimoSession({ state: "s", privateKeyDer: null })).toBe(false);
  });

  it("never exposes the private key to callers", () => {
    registerXiaomiMimoSession({ state: "s1", privateKeyDer: KEY });
    const view = getXiaomiMimoSessionStatus("s1");
    expect(view).toEqual({ status: "pending", result: null, error: null });
    expect(JSON.stringify(view)).not.toContain("privateKeyDer");
    clearXiaomiMimoSession("s1");
  });
});
