// Shared request-parameter mapping for cross-format translation.
//
// OpenAI clients express one concept several ways (max_tokens vs
// max_completion_tokens, stop as string|array); Claude and Gemini each have a
// single native spelling with its own limits. Keep that normalisation here so
// every translator maps the same way and limits live in one place.

// Provider-side limits for stop sequences.
export const STOP_SEQUENCE_LIMITS = {
  openai: 4,
  claude: 8191, // Anthropic accepts a long list; each entry is capped by tokens upstream
  gemini: 5,
};

/**
 * Error a translator throws when the request asks for something the target
 * cannot do. chatCore turns it into an HTTP 400 invalid_request_error instead of
 * silently returning a degraded result.
 */
export class RequestParamError extends Error {
  constructor(message) {
    super(message);
    this.name = "RequestParamError";
    this.status = 400;
    this.type = "invalid_request_error";
  }
}

/**
 * Token cap the client asked for. Modern OpenAI SDKs send max_completion_tokens
 * and deprecate max_tokens, so the former wins when both are present.
 */
export function resolveMaxTokens(body) {
  return body?.max_completion_tokens ?? body?.max_tokens;
}

/**
 * Normalise OpenAI `stop` (string | string[]) or a Claude/Gemini native list
 * into a clean string[]. Returns undefined when there is nothing to send.
 * Over-long lists are truncated to `max` with a console warning.
 */
export function normalizeStopSequences(stop, max, label = "target") {
  if (stop === undefined || stop === null) return undefined;
  const list = (Array.isArray(stop) ? stop : [stop])
    .filter((s) => typeof s === "string" && s.length > 0);
  if (list.length === 0) return undefined;
  if (Number.isFinite(max) && list.length > max) {
    console.warn(`[translator] ${list.length} stop sequences exceed the ${label} limit of ${max}; truncating`);
    return list.slice(0, max);
  }
  return list;
}

/**
 * Collapse a stop list to OpenAI's `stop` shape: a lone string stays a string,
 * several become an array, none is undefined.
 */
export function toOpenAIStop(list) {
  const stops = normalizeStopSequences(list, STOP_SEQUENCE_LIMITS.openai, "OpenAI");
  if (!stops) return undefined;
  return stops.length === 1 ? stops[0] : stops;
}

/**
 * Reject features a non-OpenAI target cannot honour rather than quietly
 * degrading: n>1 (we can return only one choice) and logprobs with top_logprobs.
 * Plain `logprobs: true` / `top_logprobs: 0` is ignored — clients such as IDE
 * agents send it routinely and have no use for it when the model has none.
 */
export function assertTargetSupportsParams(body, label) {
  // Source-format equivalents (Gemini generationConfig, also inside the
  // Cloud Code `request` envelope) are checked too: the guard runs before the
  // source->OpenAI hop, where candidateCount would otherwise become n and be
  // silently dropped by the target translator.
  const gen = body?.generationConfig || body?.request?.generationConfig;
  const n = Number.isFinite(body?.n) ? body.n : gen?.candidateCount;
  if (Number.isFinite(n) && n > 1) {
    throw new RequestParamError(`n>1 not supported for ${label}`);
  }
  const geminiLogprobs = gen?.responseLogprobs === true && Number.isFinite(gen.logprobs) && gen.logprobs > 0;
  if (geminiLogprobs || (body?.logprobs === true && Number.isFinite(body.top_logprobs) && body.top_logprobs > 0)) {
    throw new RequestParamError(`logprobs/top_logprobs not supported for ${label}`);
  }
}
