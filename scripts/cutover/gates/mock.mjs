const port = Number(process.env.MOCK_PORT || 9000);
const redirectTarget = process.env.REDIR_TARGET || "http://mock:9000/target.png";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
let imageHits = 0;
let lastChat = "";

Bun.serve({
  port,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/__hits") return new Response(String(imageHits));
    if (pathname === "/__last") return new Response(lastChat);
    if (pathname === "/__reset") {
      imageHits = 0;
      lastChat = "";
      return new Response("ok");
    }
    if (pathname === "/api/chat" && request.method === "POST") {
      lastChat = await request.text();
      return Response.json({
        model: "gate",
        created_at: "2026-01-01T00:00:00Z",
        message: { role: "assistant", content: "ok" },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 1,
        eval_count: 1,
      });
    }
    imageHits++;
    if (pathname === "/redir") return new Response(null, { status: 302, headers: { location: redirectTarget } });
    return new Response(png, { headers: { "content-type": "image/png" } });
  },
});
