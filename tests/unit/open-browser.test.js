import { describe, it, expect, mock } from "bun:test";
import { openBrowser } from "../../src/shared/utils/openBrowser.js";

const URL_OK = "https://auth.example.com/authorize?client_id=abc&state=xyz";

function fakeSpawn(result = { exited: Promise.resolve(0), unref() {} }) {
  return mock(() => result);
}

describe("openBrowser", () => {
  it("uses rundll32 on win32", async () => {
    const spawn = fakeSpawn();
    await openBrowser(URL_OK, { spawn, platform: "win32" });
    expect(spawn.mock.calls[0][0]).toEqual(["rundll32", "url.dll,FileProtocolHandler", URL_OK]);
  });

  it("uses open on darwin", async () => {
    const spawn = fakeSpawn();
    await openBrowser(URL_OK, { spawn, platform: "darwin" });
    expect(spawn.mock.calls[0][0]).toEqual(["open", URL_OK]);
  });

  it("uses xdg-open elsewhere", async () => {
    const spawn = fakeSpawn();
    await openBrowser(URL_OK, { spawn, platform: "linux" });
    expect(spawn.mock.calls[0][0]).toEqual(["xdg-open", URL_OK]);
  });

  it("accepts http URLs", async () => {
    const spawn = fakeSpawn();
    await openBrowser("http://localhost:20128/callback", { spawn, platform: "linux" });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("rejects javascript: and file: URLs", async () => {
    const spawn = fakeSpawn();
    await expect(openBrowser("javascript:alert(1)", { spawn, platform: "linux" })).rejects.toThrow();
    await expect(openBrowser("file:///etc/passwd", { spawn, platform: "linux" })).rejects.toThrow();
    await expect(openBrowser("not a url", { spawn, platform: "linux" })).rejects.toThrow();
    await expect(openBrowser(undefined, { spawn, platform: "linux" })).rejects.toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("propagates a spawn failure", async () => {
    const spawn = mock(() => {
      throw new Error("spawn xdg-open ENOENT");
    });
    await expect(openBrowser(URL_OK, { spawn, platform: "linux" })).rejects.toThrow("ENOENT");
  });

  it("rejects when the launcher exits non-zero", async () => {
    const spawn = fakeSpawn({ exited: Promise.resolve(3), unref() {} });
    await expect(openBrowser(URL_OK, { spawn, platform: "linux" })).rejects.toThrow();
  });
});
