import "open-sse/index.js";

import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { isUnrecoverableRefreshError } from "open-sse/services/tokenRefresh.js";
import { getExecutor } from "open-sse/executors/index.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";
import { createTtlCache, withTimeout, TimeoutError } from "@/lib/asyncLimits";

const USAGE_CACHE_TTL_MS = 45_000;
const USAGE_UPSTREAM_TIMEOUT_MS = 12_000;
const usageCache = createTtlCache({ ttlMs: USAGE_CACHE_TTL_MS });

const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];
function isAuthExpiredMessage(usage) {
  if (!usage?.message) return false;
  const msg = usage.message.toLowerCase();
  return AUTH_EXPIRED_PATTERNS.some((p) => msg.includes(p));
}

export async function refreshAndUpdateCredentials(connection, force = false, proxyOptions = null) {
  const latest = connection.id ? await getProviderConnectionById(connection.id) : null;
  if (latest) connection = latest;

  const executor = getExecutor(connection.provider);

  const credentials = {
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    idToken: connection.idToken,
    expiresAt: connection.expiresAt || connection.tokenExpiresAt,
    lastRefreshAt: connection.lastRefreshAt,
    connectionId: connection.id,
    providerSpecificData: connection.providerSpecificData,
    copilotToken: connection.providerSpecificData?.copilotToken,
    copilotTokenExpiresAt: connection.providerSpecificData?.copilotTokenExpiresAt,
  };

  const needsRefresh = force || executor.needsRefresh(credentials);

  if (!needsRefresh) {
    return { connection, refreshed: false };
  }

  const refreshResult = await executor.refreshCredentials(credentials, console, proxyOptions);

  if (refreshResult && isUnrecoverableRefreshError(refreshResult)) {
    throw new Error("Refresh token invalid or reused. Please re-authorize the connection.");
  }

  if (!refreshResult) {
    if (connection.accessToken) {
      return { connection, refreshed: false };
    }
    throw new Error("Failed to refresh credentials. Please re-authorize the connection.");
  }

  const now = new Date().toISOString();
  const updateData = {
    updatedAt: now,
  };

  if (refreshResult.accessToken) {
    updateData.accessToken = refreshResult.accessToken;
  }

  if (refreshResult.refreshToken) {
    updateData.refreshToken = refreshResult.refreshToken;
  }

  if (refreshResult.idToken) {
    updateData.idToken = refreshResult.idToken;
  }

  if (refreshResult.lastRefreshAt) {
    updateData.lastRefreshAt = refreshResult.lastRefreshAt;
  }

  if (refreshResult.expiresIn) {
    updateData.expiresAt = new Date(Date.now() + refreshResult.expiresIn * 1000).toISOString();
    updateData.expiresIn = refreshResult.expiresIn;
  } else if (refreshResult.expiresAt) {
    updateData.expiresAt = refreshResult.expiresAt;
  }

  const providerSpecificUpdates = {
    ...(refreshResult.providerSpecificData || {}),
    ...(refreshResult.copilotToken ? { copilotToken: refreshResult.copilotToken } : {}),
    ...(refreshResult.copilotTokenExpiresAt ? { copilotTokenExpiresAt: refreshResult.copilotTokenExpiresAt } : {}),
  };
  if (Object.keys(providerSpecificUpdates).length > 0) {
    updateData.providerSpecificData = {
      ...(connection.providerSpecificData || {}),
      ...providerSpecificUpdates,
    };
  }

  await updateProviderConnection(connection.id, updateData);

  const updatedConnection = {
    ...connection,
    ...updateData,
    providerSpecificData: updateData.providerSpecificData || connection.providerSpecificData,
  };

  return {
    connection: updatedConnection,
    refreshed: true,
  };
}

export async function GET(request, { params }) {
  let connection;
  try {
    const { connectionId } = await params;
    const force = new URL(request.url).searchParams.get("force") === "1";


    connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }

    const isOAuth = connection.authType === "oauth";
    const isApikeyAuth =
      connection.authType === "apikey" || connection.authType === "api_key";
    const isApikeyEligible =
      isApikeyAuth && USAGE_APIKEY_PROVIDERS.includes(connection.provider);

    if (!isOAuth && !isApikeyEligible) {
      return Response.json({ message: "Usage not available for this connection" });
    }

    const run = () => withTimeout(async () => {
      const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
      const proxyOptions = {
        connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
        connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
        connectionNoProxy: proxyConfig.connectionNoProxy || "",
        vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
        strictProxy: false,
      };

      if (isOAuth) {
        try {
          const result = await refreshAndUpdateCredentials(connection, false, proxyOptions);
          connection = result.connection;
        } catch (refreshError) {
          console.error("[Usage API] Credential refresh failed:", refreshError);
          return { status: 401, body: { error: `Credential refresh failed: ${refreshError.message}` } };
        }
      }

      let usage = await getUsageForProvider(connection, proxyOptions, { force });

      if (isOAuth && isAuthExpiredMessage(usage) && connection.refreshToken) {
        try {
          const retryResult = await refreshAndUpdateCredentials(connection, true, proxyOptions);
          connection = retryResult.connection;
          usage = await getUsageForProvider(connection, proxyOptions, { force });
        } catch (retryError) {
          console.warn(`[Usage] ${connection.provider}: force refresh failed: ${retryError.message}`);
        }
      }

      return { status: 200, body: usage };
    }, USAGE_UPSTREAM_TIMEOUT_MS, "Provider usage request");

    const result = await usageCache.get(connectionId, run, {
      bypass: force,
      shouldCache: (r) => r.status === 200 && !r.body?.error && !isAuthExpiredMessage(r.body),
    });
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    const provider = connection?.provider ?? "unknown";
    console.warn(`[Usage] ${provider}: ${error.message}`);
    return Response.json(
      { error: error.message },
      { status: error instanceof TimeoutError ? 504 : 500 },
    );
  }
}
