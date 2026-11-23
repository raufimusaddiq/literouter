import { vi as bunVi, jest } from "bun:test";

const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const envStubs = new Map();
const globalStubs = new Map();

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

  async advanceTimersByTimeAsync(ms) {
    const total = Math.max(0, Math.floor(ms));
    await flushMicrotasks();
    if (total === 0) {
      const dateBefore = Date.now();
      for (let pass = 0; pass < 100; pass++) {
        const countBefore = bunVi.getTimerCount();
        bunVi.advanceTimersByTime(0);
        const fired = bunVi.getTimerCount() < countBefore;
        await flushMicrotasks();
        if (!fired) break;
      }
      if (Date.now() !== dateBefore) jest.setSystemTime(dateBefore);
      return;
    }
    const end = { fired: false };
    let elapsedDeadline = total;
    let sentinel;
    try {
      while (!end.fired) {
        sentinel = setTimeout(() => {
          end.fired = true;
        }, elapsedDeadline);
        const before = Date.now();
        bunVi.advanceTimersToNextTimer();
        const moved = Date.now() - before;
        clearTimeout(sentinel);
        sentinel = undefined;
        elapsedDeadline -= moved;
        await flushMicrotasks();
      }
      await new Promise((r) => setImmediate(r));
      await flushMicrotasks();
    } finally {
      if (sentinel !== undefined) clearTimeout(sentinel);
    }
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
