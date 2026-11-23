const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const tls = require("tls");

const origCreate = http.createServer.bind(http);

const PEER_TOKEN = crypto.randomBytes(24).toString("hex");
process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;

function parseBodyLimit(raw) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(String(raw ?? ""));
  if (!m) return 128 * 1024 * 1024;
  const mult = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[(m[2] || "b").toLowerCase()];
  return Math.floor(Number(m[1]) * mult);
}
const MAX_H2C_BODY_BYTES = parseBodyLimit(process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE || "128mb");
const H2C_READ_TIMEOUT_MS = 120_000;

http.createServer = (...args) => {
  const handler = args.find((a) => typeof a === "function");
  const rest = args.filter((a) => typeof a !== "function");
  if (!handler) return origCreate(...args);
  const wrapped = (req, res) => {
    const socketIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
    const xff = req.headers["x-forwarded-for"];
    const xRealIp = req.headers["x-real-ip"];
    const PROXY_MARKERS = ["x-forwarded-for", "x-real-ip", "forwarded", "x-forwarded-proto", "x-forwarded-host", "via", "cf-connecting-ip", "true-client-ip"];
    const trustLoopback = String(process.env.TRUST_LOOPBACK_AS_LOCAL ?? "true").trim().toLowerCase() !== "false";
    const viaProxy = !trustLoopback || PROXY_MARKERS.some((h) => !!req.headers[h]);
    const isLoopbackProxy = socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
    const xffHops = xff ? String(xff).split(",").map((h) => h.trim()).filter(Boolean) : [];
    const proxyIp = String(xRealIp || "").trim() || (xffHops.length ? xffHops[xffHops.length - 1] : "");
    const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;
    delete req.headers["x-9r-real-ip"];
    delete req.headers["x-forwarded-for"];
    delete req.headers["x-9r-via-proxy"];
    delete req.headers["x-9r-peer-token"];
    req.headers["x-9r-real-ip"] = ip;
    req.headers["x-9r-peer-token"] = PEER_TOKEN;
    if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
    return handler(req, res);
  };
  const server = origCreate(...rest, wrapped);
  const origEmit = server.emit;
  server.emit = function (event, ...eventArgs) {
    const [req, socket, head] = eventArgs;
    if (event !== "upgrade" || String(req.headers.upgrade || "").toLowerCase() !== "h2c") {
      return origEmit.call(this, event, ...eventArgs);
    }

    const contentLength = Number(req.headers["content-length"] || 0);
    const transferEncoding = req.headers["transfer-encoding"];
    if (transferEncoding) {
      socket.end("HTTP/1.1 411 Length Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return true;
    }
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      socket.destroy();
      return true;
    }
    if (contentLength > MAX_H2C_BODY_BYTES) {
      socket.end("HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return true;
    }
    delete req.headers.upgrade;
    delete req.headers["http2-settings"];
    req.headers.connection = "close";
    const chunks = [head];
    let received = head.length;
    const serve = () => {
      const replay = new http.IncomingMessage(socket);
      Object.assign(replay, { method: req.method, url: req.url, headers: req.headers, complete: true });
      if (received) replay.push(Buffer.concat(chunks, received).subarray(0, contentLength));
      replay.push(null);
      const res = new http.ServerResponse(replay);
      res.shouldKeepAlive = false;
      res.assignSocket(socket);
      res.once("finish", () => socket.end());
      Promise.resolve().then(() => wrapped(replay, res)).catch((error) => {
        console.error("Failed to downgrade h2c request", error);
        socket.destroy();
      });
    };
    if (received >= contentLength) serve();
    else {
      socket.setTimeout(H2C_READ_TIMEOUT_MS, () => socket.destroy());
      const readBody = (chunk) => {
        if (received + chunk.length > MAX_H2C_BODY_BYTES) {
          socket.off("data", readBody);
          req.off("data", readBody);
          socket.end("HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
          return;
        }
        chunks.push(chunk);
        received += chunk.length;
        if (received < contentLength) return;
        socket.off("data", readBody);
        req.off("data", readBody);
        socket.setTimeout(0);
        serve();
      };
      socket.on("data", readBody);
      req.on("data", readBody);
      socket.resume();
    }
    return true;
  };
  return server;
};

function useSystemCaStore(tlsApi = tls) {
  if (typeof tlsApi.setDefaultCACertificates !== "function" || typeof tlsApi.getCACertificates !== "function") {
    throw new Error("CA trust: tls.setDefaultCACertificates is unavailable (Node >= 22.19 required)");
  }
  const system = tlsApi.getCACertificates("system");
  if (!Array.isArray(system) || system.length === 0) {
    throw new Error("CA trust: system CA store is empty or unreadable; refusing to fall back to Node's bundled roots");
  }
  tlsApi.setDefaultCACertificates(system);
  return system.length;
}

if (require.main === module) {
  if (process.env.LITEROUTER_SYSTEM_CA === "1") {
    try {
      console.log(`[CA trust] using ${useSystemCaStore()} system CA certificates`);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  }
  const standalone = path.join(__dirname, "server.js");
  if (fs.existsSync(standalone)) {
    require(standalone);
  } else {
    const nextBin = require.resolve("next/dist/bin/next");
    process.argv = [process.argv[0], nextBin, "start", ...process.argv.slice(2)];
    require(nextBin);
  }
}

module.exports = { useSystemCaStore };
