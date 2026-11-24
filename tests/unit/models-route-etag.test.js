import { describe, it, expect } from "bun:test";
import { useTempDataDirAtLoad } from "#test/tempDataDir";

useTempDataDirAtLoad("lr-models-etag-");

const { GET } = await import("@/app/api/models/route.js");

describe("/api/models revalidation", () => {
  it("answers 304 with no body when the client already holds the current list", async () => {
    const first = await GET(new Request("http://localhost/api/models"));
    const etag = first.headers.get("etag");
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, no-cache");
    expect((await first.json()).models.length).toBeGreaterThan(0);
    const again = await GET(new Request("http://localhost/api/models", { headers: { "if-none-match": `W/${etag}` } }));
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
  });
});
