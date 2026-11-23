
import { RESPONSES_ITEM } from "../schema/index.js";
import { coerceResponsesOutput } from "../formats/responsesApi.js";


export function stripResponsesTextFormat(body) {
  if (!body || typeof body !== "object" || !body.text || typeof body.text !== "object") return body;
  if (body.text.format === undefined) return body;
  const { format, ...text } = body.text;
  return { ...body, text };
}

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

function freeformCallArguments(freeform, fallback) {
  if (typeof freeform === "string") {
    try {
      return JSON.stringify({ input: freeform });
    } catch {}
  }
  return typeof fallback === "string" && fallback ? fallback : "{}";
}


const TOOL_CALL_ITEM_TYPES = new Set([
  RESPONSES_ITEM.FUNCTION_CALL,
  RESPONSES_ITEM.CUSTOM_TOOL_CALL,
]);

function asCustomItem(item, withInput = null) {
  const out = {
    ...item,
    type: RESPONSES_ITEM.CUSTOM_TOOL_CALL,
    id: typeof item.id === "string" && item.id.startsWith("fc_") ? `ctc_${item.id.slice(3)}` : item.id,
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
  } catch {}
  return argumentsText;
}

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


export function rewriteResponsesCustomToolOutput(body, customToolNames) {
  if (!body || typeof body !== "object" || !Array.isArray(body.output) || !customToolNames?.size) return body;
  const names = customToolNames instanceof Set ? customToolNames : new Set(customToolNames);
  body.output = body.output.map((entry) => {
    if (!entry || !TOOL_CALL_ITEM_TYPES.has(entry.type) || !names.has(entry.name)) return entry;
    return asCustomItem(entry, extractCustomToolInput(entry.arguments ?? entry.input));
  });
  return body;
}
