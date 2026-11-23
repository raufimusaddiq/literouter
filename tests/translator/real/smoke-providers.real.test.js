import { describe, it, expect, beforeAll } from "bun:test";
import { getProviderConnections } from "../../../src/lib/localDb.js";
import { getProviderCredentials } from "../../../src/sse/services/auth.js";
import { checkAndRefreshToken } from "../../../src/sse/services/tokenRefresh.js";
import { handleChatCore } from "../../../open-sse/handlers/chatCore.js";
import { getModelsByProviderId } from "../../../open-sse/config/providerModels.js";

const RUN_REAL = process.env.RUN_REAL === "1";
const MAX_TOKENS = 32;
const TIMEOUT_MS = 90000;
const PROVIDER_FILTER = (process.env.REAL_PROVIDERS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

function firstLlmModel(providerId) {
  const models = getModelsByProviderId(providerId);
  const llm = models.find((m) => (m.type || "llm") === "llm");
  return llm?.id || null;
}

async function drainSSE(response) {
  if (!response?.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

let providerIds = [];

beforeAll(async () => {
  if (!RUN_REAL) return;
  providerIds = targetProviders();
});

describe.skipIf(!RUN_REAL).concurrent("REAL provider smoke", () => {
  it("has active providers in DB", () => {
    expect(providerIds.length).toBeGreaterThan(0);
  });

  for (const providerId of (RUN_REAL ? targetProviders() : [])) {
    it.concurrent(
      `${providerId}: responds to a short prompt`,
      async () => {
        const model = firstLlmModel(providerId);
        if (!model) return expect(true).toBe(true);

        const credentials = await getProviderCredentials(providerId, new Set(), model);
        if (!credentials || credentials.allRateLimited) {
          console.warn(`[skip] ${providerId}: no usable credential`);
          return expect(true).toBe(true);
        }

        const refreshed = await checkAndRefreshToken(providerId, credentials);
        const result = await handleChatCore({
          body: {
            model: `${providerId}/${model}`,
            stream: true,
            max_tokens: MAX_TOKENS,
            messages: [{ role: "user", content: "Reply with the single word: hi" }],
          },
          modelInfo: { provider: providerId, model },
          credentials: refreshed,
          connectionId: credentials.connectionId,
        });

        if (!result.success) {
          const credIssue = [401, 402, 403, 429].includes(Number(result.status));
          if (credIssue) {
            console.warn(`[skip] ${providerId}: ${result.status} (credential/quota)`);
            return expect(true).toBe(true);
          }
          throw new Error(`${providerId} failed: ${result.status} ${result.error}`);
        }

        const raw = await drainSSE(result.response);
        expect(raw.length, `${providerId}: empty response`).toBeGreaterThan(0);
        expect(/data:|finish_reason|"delta"|"content"|event:/.test(raw), `${providerId}: not SSE`).toBe(true);
      },
      TIMEOUT_MS
    );
  }
});

function targetProviders() {
  try {
    const Database = require("better-sqlite3");
    const os = require("os");
    const path = require("path");
    const dbPath = process.env.DATA_DIR
      ? path.join(process.env.DATA_DIR, "db", "data.sqlite")
      : path.join(os.homedir(), ".9router", "db", "data.sqlite");
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT DISTINCT provider FROM providerConnections WHERE isActive = 1").all();
    db.close();
    let list = rows.map((r) => r.provider).sort();
    if (PROVIDER_FILTER.length) list = list.filter((p) => PROVIDER_FILTER.includes(p));
    return list;
  } catch {
    return [];
  }
}
