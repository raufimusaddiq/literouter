import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";
import { stripStoredItemReferences, normalizeCodexTools, convertSystemToDeveloperRole } from "./codex.js";
import { normalizeResponsesInput } from "../translator/formats/responsesApi.js";

// OpenCode Go's Responses endpoint runs with store=false, identical to Codex,
// but uses a plain OpenAI-compatible Bearer token (no ChatGPT-Account-ID,
// no codex_cli_rs originator, no session_id). Reuse CodexExecutor's sanitization
// (server-generated item IDs stripped, previous_response_id deleted) without
// any Codex-account-specific header injection.

// Allowlist of fields accepted by OpenAI Responses API.
const RESPONSES_API_ALLOWLIST = new Set([
  "model", "input", "instructions", "tools", "tool_choice", "stream", "store",
  "reasoning", "service_tier", "include", "prompt_cache_key", "client_metadata",
  "text",
]);

// Fields OpenAI /responses rejects — strip for the Responses path only.
const RESPONSES_OMIT_FIELDS = [
  "temperature", "top_p", "frequency_penalty", "presence_penalty",
  "logprobs", "top_logprobs",
  "n", "seed", "max_tokens", "max_completion_tokens", "max_output_tokens",
  "user", "prompt_cache_retention", "metadata", "stream_options", "safety_identifier",
  "previous_response_id",
];

export class OpencodeGoExecutor extends BaseExecutor {
  constructor() {
    super("opencode-go", PROVIDERS["opencode-go"]);
    this._currentSessionId = null;
  }

  // Use the sourceFormat-matched transport set by chatCore (resolves to the
  // /responses endpoint for the Responses path, /chat/completions otherwise).
  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const rt = credentials?.runtimeTransport;
    if (rt?.baseUrl) {
      return rt.urlSuffix ? `${rt.baseUrl}${rt.urlSuffix}` : rt.baseUrl;
    }
    return super.buildUrl(model, stream, urlIndex, credentials);
  }

  buildHeaders(credentials, stream = true) {
    const headers = super.buildHeaders(credentials, stream);
    const auth = credentials?.runtimeTransport?.auth;
    const token = credentials?.apiKey || credentials?.accessToken;
    if (auth?.header && token) {
      delete headers.Authorization;
      delete headers["x-api-key"];
      headers[auth.header] = auth.scheme === "bearer" ? `Bearer ${token}` : token;
      if (auth.anthropicVersion && !headers["anthropic-version"]) {
        headers["anthropic-version"] = ANTHROPIC_API_VERSION;
      }
    }
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    // Always strip previous_response_id (store=false on both transports).
    delete body.previous_response_id;

    // Responses-format path (input[] present) — this is the Luna case.
    if (Array.isArray(body.input)) {
      const normalized = normalizeResponsesInput(body.input);
      if (normalized) body.input = normalized;

      if (!body.input || body.input.length === 0) {
        body.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
      }

      convertSystemToDeveloperRole(body);
      stripStoredItemReferences(body);
      normalizeCodexTools(body);

      // OpenCode Go Responses requires streaming.
      body.stream = true;

      // Pin store=false so upstream persists nothing and the next turn never
      // references an item it cannot resolve.
      body.store = false;

      // Strip fields OpenCode Go's /responses endpoint rejects.
      for (const k of RESPONSES_OMIT_FIELDS) {
        delete body[k];
      }

      // Final allowlist — strip unknown fields that could trigger upstream rejection.
      for (const k of Object.keys(body)) {
        if (!RESPONSES_API_ALLOWLIST.has(k)) delete body[k];
      }
    }

    // Chat-completions path (messages[] present) — only strip previous_response_id.
    // Non-Luna models (glm, kimi, deepseek) work here and must not be altered.
    return body;
  }
}
