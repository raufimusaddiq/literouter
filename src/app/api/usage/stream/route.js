import { SSE_HEADERS } from "open-sse/utils/sseConstants.js";
import { statsEmitter, getActiveRequests } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

// Lightweight live feed: only the fields the dashboard merges in real time
// (activeRequests, recentRequests, errorProvider, pending). Period totals are
// NOT computed here — getUsageStats() per client per event was O(history). On a
// persisted-usage "update" the event carries `refresh: true` and the client
// refetches /api/usage/stats on a debounce.
export async function GET(request) {
  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, send: null, sendPending: null };

  // Idempotent: safe to call from request.signal abort, cancel(), or enqueue failure.
  const cleanup = () => {
    if (state.closed) return;
    state.closed = true;
    if (state.send) statsEmitter.off("update", state.send);
    if (state.sendPending) statsEmitter.off("pending", state.sendPending);
    clearInterval(state.keepalive);
  };

  // request.signal fires reliably on client disconnect; ReadableStream.cancel()
  // is not always invoked in Next.js, so a closed tab kept its listeners.
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
      // Disconnected (or failed) during the initial send: never register.
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
