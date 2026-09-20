import net from "node:net";

const state = global.__liteRouterRedis ??= {
  warned: false,
  lanes: [],
  cursor: 0,
};

function config() {
  const raw = process.env.REDIS_URL;
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    if (!state.warned) {
      console.warn(`[Redis] invalid REDIS_URL, cache disabled: ${raw}`);
      state.warned = true;
    }
    return null;
  }
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || null,
    database: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : null,
    prefix: process.env.REDIS_KEY_PREFIX || "literouter:",
  };
}

function configuredPoolSize() {
  const parsed = Number.parseInt(process.env.REDIS_POOL_SIZE || "4", 10);
  if (!Number.isFinite(parsed)) return 4;
  return Math.min(16, Math.max(1, parsed));
}

function encode(parts) {
  return `*${parts.length}\r\n${parts.map((part) => {
    const value = String(part);
    return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
  }).join("")}`;
}

// Decode one RESP reply from buffer, or null while incomplete.
function decode(buffer) {
  if (!buffer.length) return null;
  const end = buffer.indexOf(13);
  if (end < 0) return null;
  const type = buffer[0];
  const line = buffer.subarray(1, end).toString();

  if (type === 36) {
    const size = Number(line);
    if (size < 0) return { value: null, rest: buffer.subarray(end + 2) };
    const start = end + 2;
    if (buffer.length < start + size + 2) return null;
    return {
      value: buffer.subarray(start, start + size).toString(),
      rest: buffer.subarray(start + size + 2),
    };
  }

  const rest = buffer.subarray(end + 2);
  if (type === 43) return { value: line, rest };
  if (type === 45) throw new Error(line);
  if (type === 58) return { value: Number(line), rest };
  if (type === 42) return { value: null, rest };
  throw new Error(`Unsupported Redis reply: ${String.fromCharCode(type)}`);
}

function createSession(socket) {
  let buffer = Buffer.alloc(0);
  let pending = null;
  const timeoutMs = Number(process.env.REDIS_TIMEOUT_MS || 500);

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (pending) {
      let reply;
      try {
        reply = decode(buffer);
      } catch (error) {
        pending.reject(error);
        pending = null;
        break;
      }
      if (!reply) break;
      buffer = reply.rest;
      const { resolve } = pending;
      pending = null;
      socket.setTimeout(0);
      resolve(reply.value);
    }
  });

  socket.on("error", (error) => {
    pending?.reject(error);
    pending = null;
  });
  socket.on("timeout", () => {
    pending?.reject(new Error("Redis timeout"));
    pending = null;
    socket.destroy();
  });
  socket.on("close", () => {
    pending?.reject(new Error("Redis closed"));
    pending = null;
  });

  return (parts) => new Promise((resolve, reject) => {
    pending = { resolve, reject };
    socket.setTimeout(timeoutMs);
    socket.write(encode(parts), (error) => {
      if (!error) return;
      pending = null;
      socket.setTimeout(0);
      reject(error);
    });
  });
}

async function connect(cfg, lane) {
  const socket = net.createConnection({ host: cfg.host, port: cfg.port });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  const session = createSession(socket);
  if (cfg.password) await session(["AUTH", cfg.password]);
  if (cfg.database !== null) await session(["SELECT", cfg.database]);

  const conn = { session, socket };
  socket.on("close", () => {
    if (lane.conn?.socket === socket) lane.conn = null;
  });
  socket.on("error", () => {
    if (lane.conn?.socket === socket) lane.conn = null;
  });
  return conn;
}

function ensureLanes() {
  const size = configuredPoolSize();
  while (state.lanes.length < size) {
    state.lanes.push({ conn: null, chain: Promise.resolve() });
  }
  if (state.lanes.length > size) {
    const removed = state.lanes.splice(size);
    for (const lane of removed) lane.conn?.socket?.destroy();
  }
  return state.lanes;
}

function runOnLane(lane, parts) {
  const run = async () => {
    const cfg = config();
    if (!cfg) return null;
    try {
      if (!lane.conn) lane.conn = await connect(cfg, lane);
      const value = await lane.conn.session(parts);
      state.warned = false;
      return value;
    } catch (error) {
      lane.conn?.socket?.destroy();
      lane.conn = null;
      if (!state.warned) {
        console.warn(`[Redis] unavailable: ${error.message}`);
        state.warned = true;
      }
      return null;
    }
  };

  // RESP replies on one socket are ordered. Serialize only within that socket,
  // not across the whole Redis client. Other lanes remain free concurrently.
  const result = lane.chain.then(run, run);
  lane.chain = result.catch(() => {});
  return result;
}

function command(parts) {
  const cfg = config();
  if (!cfg) return Promise.resolve(null);
  const lanes = ensureLanes();
  const lane = lanes[state.cursor++ % lanes.length];
  return runOnLane(lane, parts);
}

function key(name) {
  const cfg = config();
  return cfg ? `${cfg.prefix}${name}` : name;
}

export function redisEnabled() {
  return Boolean(config());
}

export function redisPoolSize() {
  return redisEnabled() ? configuredPoolSize() : 0;
}

export async function redisPing() {
  return (await command(["PING"])) === "PONG";
}

export async function redisGet(name) {
  return command(["GET", key(name)]);
}

export async function redisSet(name, value, ttlSeconds = 0) {
  const args = ["SET", key(name), value];
  if (ttlSeconds > 0) args.push("EX", ttlSeconds);
  return command(args);
}

export async function redisDelete(name) {
  return command(["DEL", key(name)]);
}

export async function redisIncrement(name) {
  return command(["INCR", key(name)]);
}

export function closeRedisPool() {
  for (const lane of state.lanes) {
    lane.conn?.socket?.destroy();
    lane.conn = null;
  }
  state.lanes = [];
  state.cursor = 0;
}

// Test hooks: no live Redis server required for decoder/pool shape checks.
export const __redisState = state;

export function __decodeSelfCheck() {
  const bulk = Buffer.from("$3\r\nfoo\r\n+OK\r\n:42\r\n$-1\r\n");
  const first = decode(bulk);
  const second = decode(first.rest);
  const third = decode(second.rest);
  const fourth = decode(third.rest);
  if (first.value !== "foo" || second.value !== "OK" || third.value !== 42 || fourth.value !== null) {
    throw new Error("redis decode self-check failed");
  }
  return true;
}
