import { NextResponse } from "next/server";
import { assertPublicUrlResolved, fetchPublic } from "@/shared/utils/ssrfGuard.js";
import { isLocalRequest } from "@/server/guard.js";

const fetchNode = (url, options, timeout = 10000) => {
  const { localOperator, ...init } = options;
  const withTimeout = { ...init, signal: AbortSignal.timeout(timeout) };
  return fetchPublic(url, withTimeout, { allowPrivate: localOperator === true });
};

const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const getErrorMessage = (error) => {
  if (error.cause?.code === "ECONNREFUSED") return "Connection refused - provider node offline or unreachable";
  if (error.cause?.code === "ENOTFOUND") return "DNS lookup failed - invalid domain or network issue";
  if (error.cause?.code === "ETIMEDOUT") return "Connection timeout - provider node too slow";
  if (error.message.includes("timeout")) return "Request timeout (>10s) - provider node not responding";
  if (error.cause?.code === "CERT_HAS_EXPIRED") return "SSL certificate expired";
  if (error.cause?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") return "SSL certificate verification failed";
  if (error.cause?.code) return `Network error: ${error.cause.code}`;
  return "Network connection failed - check URL and network connectivity";
};

const getModelsErrorMessage = (status) => {
  if (status === 401 || status === 403) return "API key unauthorized";
  if (status === 404) return "/models endpoint not found - try chat validation with model ID";
  if (status >= 500) return "Server error - try again later";
  return `Unexpected response (${status})`;
};

const getChatErrorMessage = (status) => {
  if (status === 401 || status === 403) return "API key unauthorized";
  if (status === 400) return "Invalid model or bad request";
  if (status === 404) return "Chat endpoint not found";
  if (status >= 500) return "Server error - try again later";
  return `Chat request failed (${status})`;
};

export async function POST(request) {
  try {
    const body = await request.json();
    const { baseUrl, apiKey, type, modelId } = body;

    if (!baseUrl || !apiKey) {
      return NextResponse.json({ error: "Base URL and API key required" }, { status: 400 });
    }

    if (!isValidUrl(baseUrl)) {
      return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
    }

    const localOperator = isLocalRequest(request);
    const remote = !localOperator;
    if (remote) {
      try {
        await assertPublicUrlResolved(baseUrl);
      } catch {
        return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
      }
    }

    if (type === "anthropic-compatible") {
      let normalizedBase = baseUrl.trim().replace(/\/$/, "");
      if (normalizedBase.endsWith("/messages")) {
        normalizedBase = normalizedBase.slice(0, -9);
      }

      const modelsUrl = `${normalizedBase}/models`;
      const res = await fetchNode(modelsUrl, {
        method: "GET",
        localOperator,
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Authorization": `Bearer ${apiKey}`
        }
      });

      if (res.ok) return NextResponse.json({ valid: true });

      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ valid: false, error: "API key unauthorized" });
      }

      if (modelId) {
        const chatRes = await fetchNode(`${normalizedBase}/chat/completions`, {
          method: "POST",
          localOperator,
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1
          })
        });
        if (chatRes.ok) {
          return NextResponse.json({ valid: true, method: "chat" });
        }
        return NextResponse.json({
          valid: false,
          error: getChatErrorMessage(chatRes.status),
          method: "chat"
        });
      }

      return NextResponse.json({ valid: false, error: getModelsErrorMessage(res.status) });
    }

    if (type === "systemone") {
      const res = await fetchNode(baseUrl.replace(/\/$/, ""), {
        method: "POST",
        localOperator,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "ping", state: "ping", questions: {} }),
      });
      const valid = res.status !== 401 && res.status !== 403;
      return NextResponse.json({ valid, error: valid ? null : "API key unauthorized" });
    }

    const modelsUrl = `${baseUrl.replace(/\/$/, "")}/models`;
    const res = await fetchNode(modelsUrl, {
      localOperator,
      headers: { "Authorization": `Bearer ${apiKey}` },
    });

    if (res.ok) return NextResponse.json({ valid: true });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ valid: false, error: "API key unauthorized" });
    }

    if (modelId) {
      const chatRes = await fetchNode(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        localOperator,
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1
        })
      });
      if (chatRes.ok) {
        return NextResponse.json({ valid: true, method: "chat" });
      }
      return NextResponse.json({
        valid: false,
        error: getChatErrorMessage(chatRes.status),
        method: "chat"
      });
    }

    return NextResponse.json({ valid: false, error: getModelsErrorMessage(res.status) });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error("Error validating provider node:", {
      message: error.message,
      cause: error.cause,
      code: error.cause?.code,
      userMessage: errorMessage
    });
    return NextResponse.json({ 
      valid: false,
      error: errorMessage 
    }, { status: 500 });
  }
}
