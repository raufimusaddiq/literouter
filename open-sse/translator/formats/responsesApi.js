import { ROLE, RESPONSES_ITEM } from "../schema/index.js";

export function normalizeResponsesInput(input) {
  if (typeof input === "string") {
    const text = input.trim() === "" ? "..." : input;
    return [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text }] }];
  }
  if (Array.isArray(input)) {
    if (input.length === 0) {
      return [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "..." }] }];
    }
    return input;
  }
  return null;
}

export const MAX_RESPONSES_CALL_ID_LEN = 64;

let responsesCallIdSeq = 0;

export function clampResponsesCallId(id) {
  if (typeof id !== "string" || !id) return `call_${Date.now()}_${(responsesCallIdSeq += 1)}`;
  return id.length > MAX_RESPONSES_CALL_ID_LEN ? id.substring(0, MAX_RESPONSES_CALL_ID_LEN) : id;
}

export function coerceResponsesArguments(value) {
  if (value === undefined || value === null || value === "") return "{}";
  if (typeof value !== "string") {
    try {
      return JSON.stringify(value);
    } catch {
      return "{}";
    }
  }
  try {
    JSON.parse(value);
    return value;
  } catch {
    return "{}";
  }
}

export function coerceResponsesOutput(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    return value.map((c) => {
      try {
        return c?.text ?? JSON.stringify(c);
      } catch {
        return String(c);
      }
    }).join("");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function normalizeResponsesRequest(body) {
  if (!body || typeof body !== "object") return body;

  let result = body;
  if (body.max_tokens !== undefined) {
    result = { ...result };
    if (result.max_output_tokens === undefined) {
      result.max_output_tokens = result.max_tokens;
    }
    delete result.max_tokens;
  }

  if (!Array.isArray(body.input)) return result;

  let changed = false;
  const input = body.input.map((item) => {
    if (
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      item.content &&
      typeof item.content === "object" &&
      !Array.isArray(item.content)
    ) {
      changed = true;
      return { ...item, content: [item.content] };
    }
    return item;
  });

  return changed ? { ...result, input } : result;
}
