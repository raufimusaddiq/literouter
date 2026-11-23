import { describe, it, expect, afterAll } from "bun:test";
import { getProviderCredentials } from "../../../src/sse/services/auth.js";
import { checkAndRefreshToken } from "../../../src/sse/services/tokenRefresh.js";
import { handleChatCore } from "../../../open-sse/handlers/chatCore.js";
import { getModelsByProviderId } from "../../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../../open-sse/providers/capabilities.js";

const RUN_REAL = process.env.RUN_REAL === "1";
const TIMEOUT_MS = 90000;
const CRED_ISSUE = [401, 402, 403, 429];
const NON_CHAT_KINDS = new Set(["embedding", "image", "imageToText", "tts", "stt", "video", "music"]);

const PROVIDER_FILTER = (process.env.REAL_PROVIDERS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const PNG_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGO4I2JDEmIY1TCqYfhqAAAeBCwQ8YdREQAAAABJRU5ErkJggg==";
const WAV_B64 = "UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
const IMAGE_REMOTE_URL = "https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png";
const PDF_B64 = "JVBERi0xLjEKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDIwMF0+PmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1MiAwMDAwMCBuIAowMDAwMDAwMTAxIDAwMDAwIG4gCnRyYWlsZXI8PC9TaXplIDQvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgoxNjYKJSVFT0Y=";
const PDF_DATA_URI = `data:application/pdf;base64,${PDF_B64}`;

const CAPABILITY_PROBES = {
  vision: {
    cap: "vision",
    content: [
      { type: "text", text: "What is in this image? One word." },
      { type: "image_url", image_url: { url: PNG_DATA_URI } },
    ],
  },
  audio: {
    cap: "audioInput",
    content: [
      { type: "text", text: "Transcribe this audio. One word." },
      { type: "input_audio", input_audio: { data: WAV_B64, format: "wav" } },
    ],
  },
  imageUrl: {
    cap: "vision",
    content: [
      { type: "text", text: "What is in this image? One word." },
      { type: "image_url", image_url: { url: IMAGE_REMOTE_URL } },
    ],
  },
  file: {
    cap: "pdf",
    content: [
      { type: "text", text: "Summarize this document. One word." },
      { type: "file", file: { filename: "doc.pdf", file_data: PDF_DATA_URI } },
    ],
  },
};
const ACTIVE_PROBES = (process.env.PROBES || "vision").split(",").map((s) => s.trim()).filter(Boolean);

const CRED_MSG_RE = /subscription|unauthorized|invalid api key|invalid access token|insufficient|credits|payment|spending|organization policy|disallowed|quota|exhausted|not supported when using|not available for integrator|requires a subscription|model.*not found|does not exist|not yet known|requires a role/i;

const results = [];

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

function chatModels(providerId) {
  return getModelsByProviderId(providerId).filter((m) => !NON_CHAT_KINDS.has(m.kind || m.type || "llm"));
}

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

describe.skipIf(!RUN_REAL)("REAL vision capability survey", () => {
  const providers = RUN_REAL ? targetProviders() : [];

  it("has active providers in DB", () => {
    expect(providers.length).toBeGreaterThan(0);
  });

  for (const providerId of providers) {
    for (const m of (RUN_REAL ? chatModels(providerId) : [])) {
      const model = m.id;
      for (const probeName of ACTIVE_PROBES) {
      const probe = CAPABILITY_PROBES[probeName];
      it.concurrent(`${probeName} | ${providerId} / ${model}`, async () => {
        const caps = getCapabilitiesForModel(providerId, model);
        const capOn = !!caps[probe.cap];
        const credentials = await getProviderCredentials(providerId, new Set(), model);
        if (!credentials || credentials.allRateLimited) {
          results.push({ probe: probeName, providerId, model, cap: capOn, status: "no-cred", verdict: "skip" });
          return expect(true).toBe(true);
        }
        const refreshed = await checkAndRefreshToken(providerId, credentials);

        const result = await handleChatCore({
          body: {
            model: `${providerId}/${model}`,
            stream: true,
            max_tokens: 64,
            messages: [{ role: "user", content: probe.content }],
          },
          modelInfo: { provider: providerId, model },
          credentials: refreshed,
          connectionId: credentials.connectionId,
        });

        const status = Number(result.status) || (result.success ? 200 : 0);
        const errMsg = result.success ? "" : String(result.error || "");
        const credIssue = CRED_ISSUE.includes(status) || CRED_MSG_RE.test(errMsg);
        const ok = result.success;

        let verdict;
        if (credIssue) verdict = "skip-cred";
        else if (ok && capOn) verdict = `ok-${probeName}`;
        else if (ok && !capOn) verdict = `ok-no${probeName}-tolerated`;
        else if (!ok && !capOn) verdict = `FAIL-no${probeName}-needs-strip`;
        else verdict = `FAIL-${probeName}-capdata-wrong`;

        if (ok) await drainSSE(result.response).catch(() => {});
        results.push({ probe: probeName, providerId, model, cap: capOn, status, verdict, error: ok ? "" : String(result.error || "").slice(0, 80) });
        return expect(true).toBe(true);
      }, TIMEOUT_MS);
      }
    }
  }

  afterAll(() => {
    if (!results.length) return;
    const rank = (v) => (v.startsWith("FAIL") ? 0 : v.startsWith("ok") ? 1 : 2);
    const groups = [...new Set(results.map((r) => r.verdict))]
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    console.log("\n================ CAPABILITY SURVEY ================");
    for (const g of groups) {
      const rows = results.filter((r) => r.verdict === g);
      if (!rows.length) continue;
      console.log(`\n### ${g} (${rows.length})`);
      for (const r of rows) {
        console.log(`  [${r.status}] ${r.probe} ${r.providerId}/${r.model} cap=${r.cap}${r.error ? ` :: ${r.error}` : ""}`);
      }
    }
    console.log("\n================ END SURVEY ================\n");
  });
});
