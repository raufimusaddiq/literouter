// vitest `vi` compatibility layer for bun:test.
// Members Bun implements are copied by reference (NOT wrapped): vi.mock must stay
// the very same function so relative specifiers resolve against the calling test file.
import { vi as bunVi, jest } from "bun:test";

const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const envStubs = new Map(); // name -> { existed, value }
const globalStubs = new Map(); // name -> descriptor | undefined

const extras = {
  hoisted(fn) {
    return fn();
  },

  resetModules() {
    for (const key of Object.keys(require.cache)) {
      if (!key.includes("node_modules")) delete require.cache[key];
    }
  },

  setSystemTime(t) {
    jest.setSystemTime(t);
  },

  // Advance fake time in 1ms steps, flushing microtasks (and a macrotask
  // periodically) between steps, so timers created by awaited callbacks inside
  // the window fire, and timers past the window do not.
  async advanceTimersByTimeAsync(ms) {
    await flushMicrotasks();
    for (let elapsed = 0; elapsed < ms; elapsed++) {
      bunVi.advanceTimersByTime(1);
      await flushMicrotasks();
      if (elapsed % 50 === 49) await new Promise((r) => setImmediate(r));
    }
    await new Promise((r) => setImmediate(r));
    await flushMicrotasks();
  },

  stubGlobal(name, value) {
    if (!globalStubs.has(name)) {
      globalStubs.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    }
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    return bunVi;
  },

  unstubAllGlobals() {
    for (const [name, desc] of globalStubs) {
      if (desc) Object.defineProperty(globalThis, name, desc);
      else delete globalThis[name];
    }
    globalStubs.clear();
    return bunVi;
  },

  stubEnv(name, value) {
    if (!envStubs.has(name)) {
      envStubs.set(name, { existed: name in process.env, value: process.env[name] });
    }
    if (value === undefined) delete process.env[name];
    else process.env[name] = String(value);
    return bunVi;
  },

  unstubAllEnvs() {
    for (const [name, { existed, value }] of envStubs) {
      if (existed) process.env[name] = value;
      else delete process.env[name];
    }
    envStubs.clear();
    return bunVi;
  },

  mocked(x) {
    return x;
  },

  async waitFor(fn, { timeout = 1000, interval = 50 } = {}) {
    const deadline = Date.now() + timeout;
    let lastErr;
    for (;;) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
      }
      if (Date.now() >= deadline) throw lastErr;
      await new Promise((r) => setTimeout(r, interval));
    }
  },
};

export const vi = Object.assign({}, bunVi, extras);
export default vi;
