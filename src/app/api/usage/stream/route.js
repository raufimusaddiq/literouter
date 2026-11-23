import { SSE_HEADERS } from "open-sse/utils/sseConstants.js";
import { statsEmitter, getActiveRequests } from "@/lib/usageDb";

export async function GET(request) {
  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, send: null, sendPending: null };

  const cleanup = () => {
    if (state.closed) return;
    state.closed = true;
    if (state.send) statsEmitter.off("update", state.send);
    if (state.sendPending) statsEmitter.off("pending", state.sendPending);
    clearInterval(state.keepalive);
  };

  request.signal.addEventListener("abort", cleanup, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const push = async (refresh) => {
        if (state.closed) return;
        try {
          const live = await getActiveRequests();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...live, refresh })}\n\n`));
        } catch {
          cleanup();
        }
      };
      state.send = () => push(true);
      state.sendPending = () => push(false);

      await push(false);
      if (state.closed) return;

      statsEmitter.on("update", state.send);
      statsEmitter.on("pending", state.sendPending);

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 25000);
    },

    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: { ...SSE_HEADERS },
  });
}
