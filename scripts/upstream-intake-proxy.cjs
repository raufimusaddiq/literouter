// Host broker owns the router credential; the network-isolated agent sees only
// a Unix socket. No arbitrary destinations, headers, paths, or models.
const http = require("node:http");

function createBroker(key, target = "http://172.30.0.2:20128") {
  if (!key) throw new Error("Router inference key required");
  return http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/responses") {
      res.writeHead(403).end();
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      // ponytail: 4 MiB prompt ceiling; raise only for larger intake prompts.
      if (size > 4 * 1024 * 1024) {
        res.writeHead(413).end();
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { res.writeHead(400).end(); return; }
      if (!body || body.model !== "codex") { res.writeHead(403).end(); return; }
      const upstream = http.request(new URL("/v1/responses", target), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      }, (response) => {
        res.writeHead(response.statusCode, { "content-type": response.headers["content-type"] || "application/json" });
        response.on("error", () => res.destroy());
        response.pipe(res);
      });
      upstream.on("error", () => {
        if (res.headersSent) res.destroy();
        else res.writeHead(502).end("Model proxy unavailable");
      });
      res.on("close", () => upstream.destroy());
      upstream.end(JSON.stringify(body));
    });
    req.on("error", () => res.destroy());
  });
}

function createBridge(socketPath) {
  return http.createServer((req, res) => {
    const upstream = http.request({ socketPath, method: req.method, path: req.url,
      headers: { "content-type": "application/json" } }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.on("error", () => res.destroy());
      response.pipe(res);
    });
    upstream.on("error", () => {
      if (res.headersSent) res.destroy();
      else res.writeHead(502).end("Model proxy unavailable");
    });
    req.on("error", () => upstream.destroy());
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });
}

if (require.main === module) {
  const [mode, socketPath] = process.argv.slice(2);
  if (mode === "broker") createBroker(process.env.ROUTER_API_KEY).listen(socketPath);
  else if (mode === "bridge") createBridge(socketPath).listen(20129, "127.0.0.1");
  else throw new Error("Expected broker or bridge mode");
}

module.exports = { createBroker, createBridge };
