import { ACCEPT_ENCODING } from "open-sse/utils/zstdCompat.js";

export async function validateGrokWeb(apiKey) {
  const token = apiKey.startsWith("sso=") ? apiKey.slice(4) : apiKey;
  const randomHex = (n) => {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  };
  const statsigId = Buffer.from("e:TypeError: Cannot read properties of null (reading 'children')").toString("base64");
  const traceId = randomHex(16);
  const spanId = randomHex(8);
  const res = await fetch("https://grok.com/rest/app-chat/conversations/new", {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Accept-Encoding": ACCEPT_ENCODING,
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      Cookie: `sso=${token}`,
      Origin: "https://grok.com",
      Pragma: "no-cache",
      Referer: "https://grok.com/",
      "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      "x-statsig-id": statsigId,
      "x-xai-request-id": crypto.randomUUID(),
      traceparent: `00-${traceId}-${spanId}-00`,
    },
    body: JSON.stringify({
      temporary: true, modelName: "grok-4", modelMode: "MODEL_MODE_GROK_4", message: "ping",
      fileAttachments: [], imageAttachments: [],
      disableSearch: false, enableImageGeneration: false, returnImageBytes: false,
      returnRawGrokInXaiRequest: false, enableImageStreaming: false, imageGenerationCount: 0,
      forceConcise: false, toolOverrides: {}, enableSideBySide: true, sendFinalMetadata: true,
      isReasoning: false, disableTextFollowUps: true, disableMemory: true,
      forceSideBySide: false, isAsyncChat: false, disableSelfHarmShortCircuit: false,
    }),
  });
  if (res.status === 401 || res.status === 403) {
    return { valid: false, error: "Invalid SSO cookie — re-paste from grok.com DevTools → Cookies → sso" };
  }
  return { valid: true, error: null };
}

export async function validatePerplexityWeb(apiKey) {
  let sessionToken = apiKey;
  if (sessionToken.startsWith("__Secure-next-auth.session-token=")) {
    sessionToken = sessionToken.slice("__Secure-next-auth.session-token=".length);
  }
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const res = await fetch("https://www.perplexity.ai/rest/sse/perplexity_ask", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Origin: "https://www.perplexity.ai",
      Referer: "https://www.perplexity.ai/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      "X-App-ApiClient": "default",
      "X-App-ApiVersion": "2.18",
      Cookie: `__Secure-next-auth.session-token=${sessionToken}`,
    },
    body: JSON.stringify({
      query_str: "ping",
      params: {
        query_str: "ping", search_focus: "internet", mode: "concise", model_preference: "pplx_pro",
        sources: ["web"], attachments: [],
        frontend_uuid: crypto.randomUUID(), frontend_context_uuid: crypto.randomUUID(),
        version: "2.18", language: "en-US", timezone: tz,
        search_recency_filter: null, is_incognito: true, use_schematized_api: true, last_backend_uuid: null,
      },
    }),
  });
  if (res.status === 401 || res.status === 403) {
    return { valid: false, error: "Invalid session cookie — re-paste __Secure-next-auth.session-token from perplexity.ai" };
  }
  return { valid: true, error: null };
}
