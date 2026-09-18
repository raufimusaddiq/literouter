import net from "node:net";

const state = global.__liteRouterRedis ??= { client: null, warned: false };

function config() {
  const raw = process.env.REDIS_URL;
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    if (!state.warned) { console.warn(`[Redis] invalid REDIS_URL, cache disabled: ${raw}`); state.warned = true; }
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

function encode(parts) {
  return `*${parts.length}\r\n${parts.map((part) => {
    const value = String(part);
    return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
  }).join("")}`;
}

function readReply(socket) {
  let buffer = Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    const fail = (error) => { socket.destroy(); reject(error); };
    const parse = () => {
      if (!buffer.length) return;
      const end = buffer.indexOf(13);
      if (end < 0) return;
      const type = buffer[0];
      const line = buffer.subarray(1, end).toString();
      if (type === 36) {
        const size = Number(line);
        if (size < 0) return resolve(null);
        const start = end + 2;
        if (buffer.length < start + size + 2) return;
        return resolve(buffer.subarray(start, start + size).toString());
      }
      buffer = buffer.subarray(end + 2);
      if (type === 43) return resolve(line);
      if (type === 45) return reject(new Error(line));
      if (type === 58) return resolve(Number(line));
      if (type === 42) return resolve(null);
      fail(new Error(`Unsupported Redis reply: ${String.fromCharCode(type)}`));
    };
    socket.setTimeout(Number(process.env.REDIS_TIMEOUT_MS || 500));
    socket.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); parse(); });
    socket.on("error", fail);
    socket.on("timeout", () => fail(new Error("Redis timeout")));
    socket.on("close", () => { if (!buffer.length) reject(new Error("Redis closed")); });
  });
}

async function command(parts) {
  const cfg = config();
  if (!cfg) return null;
  const socket = net.createConnection({ host: cfg.host, port: cfg.port });
  try {
    await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    if (cfg.password) { socket.write(encode(["AUTH", cfg.password])); await readReply(socket); }
    if (cfg.database !== null) { socket.write(encode(["SELECT", cfg.database])); await readReply(socket); }
    socket.write(encode(parts));
    return await readReply(socket);
  } catch (error) {
    if (!state.warned) { console.warn(`[Redis] unavailable: ${error.message}`); state.warned = true; }
    return null;
  } finally {
    socket.destroy();
  }
}

function key(name) {
  const cfg = config();
  return cfg ? `${cfg.prefix}${name}` : name;
}

export function redisEnabled() { return Boolean(config()); }
export async function redisPing() { return (await command(["PING"])) === "PONG"; }
export async function redisGet(name) { return command(["GET", key(name)]); }
export async function redisSet(name, value, ttlSeconds = 0) {
  const args = ["SET", key(name), value];
  if (ttlSeconds > 0) args.push("EX", ttlSeconds);
  return command(args);
}
export async function redisDelete(name) { return command(["DEL", key(name)]); }
export async function redisIncrement(name) { return command(["INCR", key(name)]); }
