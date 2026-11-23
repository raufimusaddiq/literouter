export const ERROR_TYPES = {
  400: { type: "invalid_request_error", code: "bad_request" },
  401: { type: "authentication_error", code: "invalid_api_key" },
  402: { type: "billing_error", code: "payment_required" },
  403: { type: "permission_error", code: "permission_denied" },
  404: { type: "invalid_request_error", code: "model_not_found" },
  406: { type: "invalid_request_error", code: "model_not_supported" },
  408: { type: "server_error", code: "upstream_request_timeout" },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  500: { type: "server_error", code: "internal_server_error" },
  502: { type: "server_error", code: "bad_gateway" },
  503: { type: "server_error", code: "service_unavailable" },
  504: { type: "server_error", code: "gateway_timeout" }
};

export const DEFAULT_ERROR_MESSAGES = {
  400: "Bad request",
  401: "Invalid API key provided",
  402: "Payment required",
  403: "You exceeded your current quota",
  404: "Model not found",
  406: "Model not supported",
  408: "Upstream timed out reading the request",
  429: "Rate limit exceeded",
  500: "Internal server error",
  502: "Bad gateway - upstream provider error",
  503: "Service temporarily unavailable",
  504: "Gateway timeout"
};

export const BACKOFF_CONFIG = {
  base: 2000,
  max: 5 * 60 * 1000,
  maxLevel: 15
};

export const TRANSIENT_COOLDOWN_MS = 30 * 1000;

export const MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

const COOLDOWN = {
  long: 2 * 60 * 1000,
  short: 5 * 1000,
};

export const SCOPE = { request: "request", model: "model", account: "account" };

export const ERROR_RULES = [
  { text: "context_length_exceeded",  scope: SCOPE.model, cooldownMs: 0 },
  { text: "maximum context length",   scope: SCOPE.model, cooldownMs: 0 },
  { text: "content_policy_violation", scope: SCOPE.request, cooldownMs: 0 },
  { text: "content management policy", scope: SCOPE.request, cooldownMs: 0 },
  { text: "invalid_prompt",           scope: SCOPE.request, cooldownMs: 0 },
  { provider: "nvidia", text: "degraded", cooldownMs: 15 * 60 * 1000 },
  { text: "no credentials",           cooldownMs: COOLDOWN.long },
  { text: "request not allowed",      cooldownMs: COOLDOWN.short },
  { text: "improperly formed request", scope: SCOPE.request, cooldownMs: 0 },
  { text: "rate limit",               backoff: true },
  { text: "too many requests",        backoff: true },
  { text: "quota exceeded",           backoff: true },
  { text: "insufficient credit",      backoff: true },
  { text: "credit balance is too low", backoff: true },
  { text: "capacity",                 backoff: true },
  { text: "overloaded",               backoff: true },

  { status: 401, cooldownMs: COOLDOWN.long },
  { status: 402, cooldownMs: COOLDOWN.long },
  { status: 403, cooldownMs: COOLDOWN.long },
  { status: 404, cooldownMs: COOLDOWN.long },
  { status: 408, cooldownMs: COOLDOWN.short },
  { status: 429, backoff: true },
];

export const COOLDOWN_MS = {
  unauthorized: COOLDOWN.long,
  paymentRequired: COOLDOWN.long,
  notFound: COOLDOWN.long,
  transient: TRANSIENT_COOLDOWN_MS,
  requestNotAllowed: COOLDOWN.short,
};

export const CLAUDE_ERROR_TYPES = {
  400: "invalid_request_error",
  401: "authentication_error",
  402: "billing_error",
  403: "permission_error",
  404: "not_found_error",
  406: "invalid_request_error",
  413: "request_too_large",
  429: "rate_limit_error",
  500: "api_error",
  502: "api_error",
  503: "overloaded_error",
  504: "api_error",
  529: "overloaded_error"
};

export const GEMINI_ERROR_STATUS = {
  400: "INVALID_ARGUMENT",
  401: "UNAUTHENTICATED",
  402: "FAILED_PRECONDITION",
  403: "PERMISSION_DENIED",
  404: "NOT_FOUND",
  406: "INVALID_ARGUMENT",
  413: "INVALID_ARGUMENT",
  429: "RESOURCE_EXHAUSTED",
  500: "INTERNAL",
  502: "UNAVAILABLE",
  503: "UNAVAILABLE",
  504: "DEADLINE_EXCEEDED"
};
