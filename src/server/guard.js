import { getSettings, validateApiKey } from "@/lib/db/index.js";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { buildErrorBody, resolveErrorFormat } from "open-sse/utils/error.js";
import { checkApiKeyThrottle, recordApiKeyFailure } from "@/lib/auth/apiKeyThrottle";
import { safeEqual } from "@/shared/utils/safeEqual";
import { json, nextUrl, cookies } from "@/server/http.js";
import { getRequestContext } from "@/server/context.js";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;
async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

async function hasValidCliToken(request) {
  const token = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  return safeEqual(token, await getCliToken());
}

const PUBLIC_API_PATHS = [
  "/api/health",
  "/api/locale",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",
  "/api/settings/require-login",
];

const PUBLIC_PREFIXES = ["/v1", "/v1beta", "/api/v1", "/api/v1beta", "/codex", "/responses"];

const ALWAYS_PROTECTED = [
  "/api/keys",
  "/api/settings/database",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
];

const PROTECTED_API_PATHS = [
  "/api/settings",
  "/api/keys",
  "/api/providers",
  "/api/provider-nodes",
  "/api/combos",
  "/api/models",
  "/api/usage",
  "/api/oauth",
  "/api/cloud",
  "/api/pricing",
  "/api/tags",
  "/api/console-logs",
  "/api/translator",
];

const LOCAL_ONLY_PATHS = [
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
  "/api/auth/reset-password",
  "/api/headroom/start",
  "/api/headroom/stop",
  "/api/headroom/proxy",
  "/api/headroom/restart",
  "/api/pxpipe/install",
  "/api/pxpipe/start",
];

const LOCAL_ONLY_MUTATING_PATHS = ["/api/headroom/extras"];

const MINIMAL_HIDDEN_PREFIXES = [
  "/api/headroom",
];

export function isLocalRequest(request) {
  return getRequestContext(request).isLocal;
}

function isPublicLlmApi(pathname) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isLocalOnlyRoute(request) {
  const { pathname } = nextUrl(request);
  if (LOCAL_ONLY_PATHS.some((p) => pathname.startsWith(p))) return true;
  const method = (request.method || "GET").toUpperCase();
  return method !== "GET" && method !== "HEAD" &&
    LOCAL_ONLY_MUTATING_PATHS.some((p) => pathname.startsWith(p));
}

function extractApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader) return apiKeyHeader;
  const googleApiKeyHeader = request.headers.get("x-goog-api-key");
  if (googleApiKeyHeader) return googleApiKeyHeader;
  return nextUrl(request).searchParams.get("key") || null;
}

async function hasValidApiKey(request) {
  const apiKey = extractApiKey(request);
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}

function throttleKey(request) {
  return getRequestContext(request).clientIp || null;
}

async function canAccessPublicLlmApi(request) {
  if (isLocalRequest(request)) return true;
  if (await hasValidCliToken(request)) return true;
  if (await hasValidApiKey(request)) return true;
  const ip = throttleKey(request);
  if (ip && extractApiKey(request)) recordApiKeyFailure(ip);
  return false;
}

async function canAccessLocalOnlyRoute(request) {
  if (await hasValidCliToken(request)) return true;
  if (isLocalRequest(request) && await isAuthenticated(request)) return true;
  return false;
}

async function hasValidToken(request) {
  const token = cookies(request).get("auth_token");
  return await verifyDashboardAuthToken(token);
}

async function loadSettings() {
  try {
    return await getSettings();
  } catch {
    return null;
  }
}

async function isAuthenticated(request) {
  if (await hasValidToken(request)) return true;
  const settings = await loadSettings();
  if (settings && settings.requireLogin === false) return true;
  return false;
}

function isPublicApi(pathname) {
  if (isPublicLlmApi(pathname)) return true;
  return PUBLIC_API_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function redirectTo(target) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(target));
      controller.close();
    },
  });
  return new Response(body, { status: 307, headers: { Location: target } });
}

export const __test__ = {
  isLocalRequest,
  isPublicLlmApi,
  extractApiKey,
  canAccessPublicLlmApi,
  canAccessLocalOnlyRoute,
};

export async function guard(request) {
  const { pathname } = nextUrl(request);

  if (process.env.MINIMAL_PROFILE === "true" && MINIMAL_HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (pathname.startsWith("/api/")) {
      return json({ error: "Not available in minimal profile" }, { status: 404 });
    }
    return redirectTo("/dashboard");
  }

  if (isLocalOnlyRoute(request)) {
    if (!(await canAccessLocalOnlyRoute(request))) {
      return json({ error: "Local only: CLI token required" }, { status: 403 });
    }
  }

  if (ALWAYS_PROTECTED.some((p) => pathname.startsWith(p))) {
    if (await hasValidCliToken(request) || await hasValidToken(request))
      return null;
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isPublicLlmApi(pathname)) {
    if (await canAccessPublicLlmApi(request)) return null;
    const format = resolveErrorFormat(pathname);
    const ip = throttleKey(request);
    const gate = ip ? checkApiKeyThrottle(ip) : { blocked: false };
    if (gate.blocked) {
      return json(
        buildErrorBody(429, "Too many failed authentication attempts", format),
        { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
      );
    }
    return json(buildErrorBody(401, "API key required for remote API access", format), { status: 401 });
  }

  if (pathname.startsWith("/api/")) {
    if (isPublicApi(pathname)) return null;
    if (await hasValidCliToken(request) || await isAuthenticated(request))
      return null;
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  if (pathname.startsWith("/dashboard")) {
    let requireLogin = true;

    try {
      const settings = await loadSettings();
      if (settings) {
        requireLogin = settings.requireLogin !== false;
      }
    } catch {
    }

    if (!requireLogin) return null;

    const token = cookies(request).get("auth_token");
    if (token) {
      if (await verifyDashboardAuthToken(token)) {
        return null;
      } else {
        return redirectTo("/login");
      }
    }

    return redirectTo("/login");
  }

  if (pathname === "/") {
    return redirectTo("/dashboard");
  }

  return null;
}
