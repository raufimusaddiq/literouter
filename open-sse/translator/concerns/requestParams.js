
export const STOP_SEQUENCE_LIMITS = {
  openai: 4,
  claude: 8191,
  gemini: 5,
};

export class RequestParamError extends Error {
  constructor(message) {
    super(message);
    this.name = "RequestParamError";
    this.status = 400;
    this.type = "invalid_request_error";
  }
}

export function resolveMaxTokens(body) {
  return body?.max_completion_tokens ?? body?.max_tokens;
}

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

export function toOpenAIStop(list) {
  const stops = normalizeStopSequences(list, STOP_SEQUENCE_LIMITS.openai, "OpenAI");
  if (!stops) return undefined;
  return stops.length === 1 ? stops[0] : stops;
}

export function assertTargetSupportsParams(body, label) {
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
