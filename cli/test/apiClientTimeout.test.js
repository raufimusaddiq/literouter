import { describe, expect, it } from "bun:test";
import http from "node:http";

const api = require("../src/cli/api/client");

const startSilentServer = () =>
  new Promise((resolve) => {
    const sockets = new Set();
    const server = http.createServer(() => {});
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, sockets }));
  });

describe("api client request timeout", () => {
  it("applies the timeout passed to getModels", async () => {
    const { server, sockets } = await startSilentServer();
    api.configure({ host: "127.0.0.1", port: server.address().port });
    const started = Date.now();
    try {
      const result = await api.getModels({ timeout: 300 });
      const elapsed = Date.now() - started;

      expect(result).toEqual({ success: false, error: "Request timeout" });
      expect(elapsed).toBeLessThan(3000);
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
      api.configure({ host: "127.0.0.1", port: 20128 });
    }
  });
});
