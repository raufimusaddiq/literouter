import { getCapabilitiesForModel } from "../../providers/capabilities.js";


const STRIP_RULES = [
  { match: /claude/i, drop: ["temperature"] },
  { provider: "github", match: /gpt-5\.4/i, drop: ["temperature"] },
  { provider: "github", match: (m) => /claude/i.test(m) && !/claude.*(opus|sonnet).*4\.6/i.test(m), drop: ["thinking", "reasoning_effort"] },
  { provider: "cloudflare-ai", flattenContent: true },
  { provider: "xiaomi-mimo", match: /preview/i, flattenContent: true },
  { provider: "volcengine-ark", match: /glm-5/i, clampToModelMaxOutput: true },
  { provider: "volcengine-ark", match: /kimi/i, maxOutputCap: 32768, clampToModelMaxOutput: true },
  { provider: "groq", dropMessageFields: ["reasoning_content", "reasoning", "reasoning_details"], dropToolFields: ["is_error"] },
  { provider: "mistral", dropMessageFields: ["reasoning_content", "reasoning", "reasoning_details"], dropToolFields: ["is_error"] },
  { provider: "cerebras", dropMessageFields: ["reasoning_content", "reasoning", "reasoning_details"], dropToolFields: ["is_error"] },
  {
    provider: "nvidia",
    drop: [
      "client_metadata",
      "prompt_cache_key",
      "service_tier",
      "anthropic_beta",
      "thinking_budget",
      "user_id",
      "custom_field",
    ],
    renameMessageFields: { reasoning: "reasoning_content" },
  },
  { provider: "opencode-go", match: /^deepseek/i, drop: ["response_format"] },
  { provider: "openai", renameParams: { max_tokens: "max_completion_tokens" } },
];

function matches(rule, model) {
  if (!rule.match) return true;
  return typeof rule.match === "function" ? rule.match(model) : rule.match.test(model);
}

function clampNumber(body, key, ceiling) {
  if (typeof body[key] === "number" && Number.isFinite(body[key]) && body[key] > ceiling) {
    body[key] = ceiling;
  }
}

export function stripUnsupportedParams(provider, model, body) {
  if (!model || !body || typeof body !== "object") return body;
  for (const rule of STRIP_RULES) {
    if (rule.provider && rule.provider !== provider) continue;
    if (!matches(rule, model)) continue;
    for (const [from, to] of Object.entries(rule.renameParams || {})) {
      if (body[from] === undefined) continue;
      if (body[to] === undefined) body[to] = body[from];
      delete body[from];
    }
    for (const key of rule.drop || []) {
      if (body[key] !== undefined) delete body[key];
    }
    if ((rule.renameMessageFields || rule.dropMessageFields) && Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (!msg || msg.role !== "assistant") continue;
        for (const [from, to] of Object.entries(rule.renameMessageFields || {})) {
          if (msg[from] === undefined) continue;
          const existing = msg[to];
          if (existing === undefined || existing === null || (typeof existing === "string" && !existing.trim())) {
            msg[to] = msg[from];
          }
          delete msg[from];
        }
        for (const key of rule.dropMessageFields || []) {
          if (msg[key] !== undefined) delete msg[key];
        }
      }
    }
    if (rule.dropToolFields && Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (!msg || msg.role !== "tool") continue;
        for (const key of rule.dropToolFields) {
          if (msg[key] !== undefined) delete msg[key];
        }
      }
    }
    if (rule.flattenContent && Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (msg && Array.isArray(msg.content)) {
          msg.content = msg.content
            .map(b => (b?.type === "text" && typeof b.text === "string") ? b.text : "")
            .join("");
        }
      }
    }
    if (rule.clampToModelMaxOutput || Number.isFinite(rule.maxOutputCap)) {
      const modelCeiling = getCapabilitiesForModel(provider, model).maxOutput;
      const candidates = [];
      if (rule.clampToModelMaxOutput && Number.isFinite(modelCeiling) && modelCeiling > 0) {
        candidates.push(modelCeiling);
      }
      if (Number.isFinite(rule.maxOutputCap) && rule.maxOutputCap > 0) {
        candidates.push(rule.maxOutputCap);
      }
      if (candidates.length > 0) {
        const ceiling = Math.min(...candidates);
        clampNumber(body, "max_tokens", ceiling);
        clampNumber(body, "max_completion_tokens", ceiling);
        clampNumber(body, "max_output_tokens", ceiling);
      }
    }
  }
  return body;
}
