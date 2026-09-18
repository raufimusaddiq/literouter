// Kenari /v1/responses subset: only flat `type:"function"` tool declarations are
// honored — `custom` (freeform), `web_search`, `local_shell`, etc. are silently
// dropped, and `text.format` structured outputs are rejected with HTTP 400
// ("structured outputs are not available on /v1/responses yet").
// Codex CLI relies on exactly those: its shell tool `exec` is `type:"custom"`
// and its recap turns send `text.format:{type:"json_schema"}`.
//
// Providers with quirks.responsesFunctionToolsOnly get this compensation:
//   request : custom tool → function tool with one freeform `input` string
//             text.format → stripped
//   response: function_call items/events for converted names are rewritten to
//             custom_tool_call so Codex still sees its native custom-tool wire
//             events (response.custom_tool_call_input.delta/done + output_item).
//
// Request conversion mirrors openaiResponsesToOpenAIRequest() (one freeform
// `input` param) and records converted names on `body._customToolNames` — the
// same contract the responses→chat translator uses — so the non-streaming
// handlers can map tool calls back without extra wiring.

import { RESPONSES_ITEM } from "../schema/index.js";
import { coerceResponsesOutput } from "../formats/responsesApi.js";

// ---- Request side ----

export function stripResponsesTextFormat(body) {
  if (!body || typeof body !== "object" || !body.text || typeof body.text !== "object") return body;
  if (body.text.format === undefined) return body;
  const { format, ...text } = body.text;
  return { ...body, text };
}

// Custom tool shape → function shape with a single freeform `input` parameter.
// Returns { body, converted } where converted lists the tool names that were
// rewritten (empty when the body is untouched).
export function convertResponsesCustomTools(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.tools)) return { body, converted: [] };

  const converted = [];
  const tools = body.tools.map((tool) => {
    if (tool?.type !== "custom") return tool;
    const name = typeof tool.name === "string" ? tool.name.trim() : "";
    if (!name) return tool;
    converted.push(name);
    const formatHint = [tool.format?.syntax, tool.format?.definition].filter(Boolean).join("\n");
    return {
      type: "function",
      name,
      description: [String(tool.description || ""), formatHint].filter(Boolean).join("\n\n"),
      parameters: {
        type: "object",
        properties: {
          input: {
            type: "string",
            description: "Raw freeform input for this custom tool"
          }
        },
        required: ["input"],
        additionalProperties: false
      },
      strict: false
    };
  });

  if (!converted.length) return { body, converted };

  const result = { ...body, tools };
  if (Array.isArray(result._customToolNames)) {
    result._customToolNames = [...new Set([...result._customToolNames, ...converted])];
  } else {
    result._customToolNames = converted;
  }
  return { body: result, converted };
}

export function applyResponsesFunctionToolsQuirk(body) {
  if (!body || typeof body !== "object") return body;
  return convertResponsesCustomTools(convertResponsesCustomToolHistory(stripResponsesTextFormat(body))).body;
}

// History replay: Codex sends prior turns back as `custom_tool_call` /
// `custom_tool_call_output` items (its native wire), but the endpoint only
// accepts `function_call` / `function_call_output`. Without this the model
// cannot see its own previous exec calls/outputs and reports a "tooling
// outage" (exec cell not found / nothing returned).
//  - input (freeform string) → arguments JSON {"input": ...} — the exact shape
//    the converted function tool declares
//  - output (string or content array) → string
//  - ctc_/ctco_ item ids → fc_/fco_ so the id family matches the item type
export function convertResponsesCustomToolHistory(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.input)) return body;

  let changed = false;
  const input = body.input.map((item) => {
    if (!item || typeof item !== "object") return item;

    if (item.type === RESPONSES_ITEM.CUSTOM_TOOL_CALL) {
      changed = true;
      const { type, input: freeform, id, ...rest } = item;
      return {
        ...rest,
        type: RESPONSES_ITEM.FUNCTION_CALL,
        id: remapCustomItemId(id, "ctc_", "fc_"),
        arguments: freeformCallArguments(freeform, rest.arguments),
      };
    }

    if (item.type === RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT) {
      changed = true;
      const { type, output, id, ...rest } = item;
      return {
        ...rest,
        type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT,
        id: remapCustomItemId(id, "ctco_", "fco_"),
        output: coerceResponsesOutput(output),
      };
    }

    return item;
  });

  return changed ? { ...body, input } : body;
}

function remapCustomItemId(id, fromPrefix, toPrefix) {
  return typeof id === "string" && id.startsWith(fromPrefix) ? `${toPrefix}${id.slice(fromPrefix.length)}` : id;
}

// Freeform custom-tool input → the arguments JSON the converted `function`
// tool declares: {"input": "<freeform>"}. Falls back to an existing arguments
// string (already-converted replay), else "{}".
function freeformCallArguments(freeform, fallback) {
  if (typeof freeform === "string") {
    try {
      return JSON.stringify({ input: freeform });
    } catch { /* unstringifiable — fall through */ }
  }
  return typeof fallback === "string" && fallback ? fallback : "{}";
}

// ---- Response side (streaming) ----

// Conversation item types that carry a tool call.
const TOOL_CALL_ITEM_TYPES = new Set([
  RESPONSES_ITEM.FUNCTION_CALL,
  RESPONSES_ITEM.CUSTOM_TOOL_CALL,
]);

function asCustomItem(item, withInput = null) {
  const out = {
    ...item,
    type: RESPONSES_ITEM.CUSTOM_TOOL_CALL,
    id: typeof item.id === "string" && item.id.startsWith("fc_") ? `ctc_${item.id.slice(3)}` : item.id,
    // custom_tool_call items carry `input`, never `arguments`
    input: withInput !== null ? withInput : "",
  };
  delete out.arguments;
  return out;
}

function extractCustomToolInput(argumentsText) {
  if (typeof argumentsText !== "string") return "";
  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && typeof parsed.input === "string") return parsed.input;
  } catch { /* incomplete or raw freeform input */ }
  return argumentsText;
}

/**
 * Rewrite one parsed Responses SSE event for converted custom tools.
 * Stateless convenience wrapper — prefer createResponsesEventRewriter() per
 * stream so argument events (delta/done) can be resolved via remembered ids.
 * Returns null when the event must be suppressed (argument deltas — Codex wants
 * the whole freeform input at once), or { event, data } for the event to emit.
 */
export function rewriteResponsesCustomToolEvent(eventName, data, customToolNames) {
  if (customToolNames instanceof Set || Array.isArray(customToolNames)) {
    return createResponsesEventRewriter(customToolNames)(eventName, data);
  }
  // A stateful rewriter was passed in directly.
  return customToolNames?.(eventName, data) ?? { event: eventName, data };
}

/**
 * Stateful per-stream rewriter. Tracks converted item ids seen on
 * output_item.added so later argument events (which carry only `item_id`,
 * no `item`) can be resolved back to the tool name.
 */
export function createResponsesEventRewriter(customToolNames) {
  const names = customToolNames instanceof Set ? customToolNames : new Set(customToolNames || []);
  const convertedItemIds = new Set();

  const isConvertedItem = (item) =>
    !!item && TOOL_CALL_ITEM_TYPES.has(item.type) && names.has(item.name);

  const rememberItemId = (item) => {
    if (isConvertedItem(item) && typeof item.id === "string" && item.id) {
      convertedItemIds.add(item.id);
    }
  };

  const customItemId = (itemId) =>
    typeof itemId === "string" && itemId.startsWith("fc_") ? `ctc_${itemId.slice(3)}` : itemId;

  return (eventName, data) => {
    if (!eventName || !names.size || !data || typeof data !== "object") return { event: eventName, data };
    const item = data.item;

    switch (eventName) {
      case "response.output_item.added":
        rememberItemId(item);
        if (isConvertedItem(item)) {
          return { event: eventName, data: { ...data, item: asCustomItem(item) } };
        }
        return { event: eventName, data };

      case "response.output_item.done":
        rememberItemId(item);
        if (isConvertedItem(item)) {
          return {
            event: eventName,
            data: { ...data, item: asCustomItem(item, extractCustomToolInput(item.arguments ?? item.input)) }
          };
        }
        return { event: eventName, data };

      // Freeform input must arrive whole (Codex applies pragmas on the full text),
      // so drop the streamed JSON-argument fragments.
      case "response.function_call_arguments.delta":
        return convertedItemIds.has(data.item_id) ? null : { event: eventName, data };

      case "response.function_call_arguments.done":
        if (convertedItemIds.has(data.item_id)) {
          const input = extractCustomToolInput(data.arguments);
          return {
            event: "response.custom_tool_call_input.done",
            data: { ...data, item_id: customItemId(data.item_id), input, arguments: undefined }
          };
        }
        return { event: eventName, data };

      // Final response payload: swap the output item so completion history
      // (Codex replays it into the next turn) matches the announced item type.
      case "response.completed": {
        const output = data?.response?.output;
        if (!Array.isArray(output)) return { event: eventName, data };
        let changed = false;
        const rewritten = output.map((entry) => {
          if (!isConvertedItem(entry)) return entry;
          changed = true;
          return asCustomItem(entry, extractCustomToolInput(entry.arguments ?? entry.input));
        });
        return changed
          ? { event: eventName, data: { ...data, response: { ...data.response, output: rewritten } } }
          : { event: eventName, data };
      }

      default:
        return { event: eventName, data };
    }
  };
}

// ---- Response side (non-streaming) ----

// Swap function_call output items for custom_tool_call items in a Responses
// response body (non-streaming path). Mutates and returns the body.
export function rewriteResponsesCustomToolOutput(body, customToolNames) {
  if (!body || typeof body !== "object" || !Array.isArray(body.output) || !customToolNames?.size) return body;
  const names = customToolNames instanceof Set ? customToolNames : new Set(customToolNames);
  body.output = body.output.map((entry) => {
    if (!entry || !TOOL_CALL_ITEM_TYPES.has(entry.type) || !names.has(entry.name)) return entry;
    return asCustomItem(entry, extractCustomToolInput(entry.arguments ?? entry.input));
  });
  return body;
}
