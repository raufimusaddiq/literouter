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

  // Jump from deadline to deadline instead of stepping every ms. A sentinel timer at the
  // window end guarantees advanceTimersToNextTimer never lands past the window. The sentinel is
  // re-armed (newest timer) before every jump so timers created inside the window with a deadline
  // exactly at the window end still fire before it. Microtasks are flushed after every jump so
  // timers created by awaited callbacks also fire. Elapsed time is measured via Date.now() (so a
  // callback calling setSystemTime mid-window skews it). Bun's timer clock has integer-ms resolution
  // and treats delay 0 as 1ms, so fractional ms are floored.
  //
  // advance(0): fires timers due "now" (setTimeout(fn), setTimeout(fn, 0)) and delay-0 timers
  // scheduled by their awaited callbacks, like vitest. Bun can only do this through
  // advanceTimersByTime(0), which moves its timer clock 1ms per pass, so (a) Date.now() is
  // restored with setSystemTime, (b) the internal timer clock still drifts 1ms per pass, and
  // (c) Bun cannot tell setTimeout(fn, 0) from setTimeout(fn, 1): a 1ms timer also fires
  // (vitest would not fire it).
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
