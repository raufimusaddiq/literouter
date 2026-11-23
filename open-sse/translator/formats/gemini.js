
import { safeParseJSON } from "../concerns/json.js";
import { DEFAULT_IMAGE_MIME, OPENAI_BLOCK } from "../schema/index.js";
import { isGemini4Model } from "../../providers/capabilities.js";

export const UNSUPPORTED_SCHEMA_CONSTRAINTS = [
  "minLength", "maxLength", "exclusiveMinimum", "exclusiveMaximum",
  "minItems", "maxItems", "format", "multipleOf",
  "uniqueItems", "contains",
  "unevaluatedProperties", "unevaluatedItems", "contentSchema",
  "prefixItems", "additionalItems",
  "default", "examples",
  "$schema", "$defs", "definitions", "const", "$ref", "$comment",
  "deprecated", "readOnly", "writeOnly",
  "additionalProperties", "propertyNames", "patternProperties", "enumDescriptions",
  "anyOf", "oneOf", "allOf", "not",
  "dependencies", "dependentSchemas", "dependentRequired",
  "title", "optional", "~optional", "deprecated", "if", "then", "else", "contentMediaType", "contentEncoding",
  "cornerRadius", "fillColor", "fontFamily", "fontSize", "fontWeight",
  "gap", "padding", "strokeColor", "strokeThickness", "textColor",
  "errorMessage", "errorMessages", "x-errorMessage", "x-errorMessages",
  "markdownDescription", "x-intellij-html-description",
  "x-taplo-info", "x-taplo", "doNotSuggest", "suggestSortText",
  "minProperties", "maxProperties"
];

export const DEFAULT_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "OFF" }
];

function remoteImageMimeType(url) {
  let pathname;
  try { pathname = new URL(url).pathname.toLowerCase(); }
  catch { return DEFAULT_IMAGE_MIME; }
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  if (pathname.endsWith(".bmp")) return "image/bmp";
  return DEFAULT_IMAGE_MIME;
}

export function convertOpenAIContentToParts(content) {
  const parts = [];

  if (typeof content === "string") {
    parts.push({ text: content });
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === OPENAI_BLOCK.TEXT) {
        parts.push({ text: item.text });
      } else if (item.type === OPENAI_BLOCK.IMAGE_URL && item.image_url?.url?.startsWith("data:")) {
        const url = item.image_url.url;
        const commaIndex = url.indexOf(",");
        if (commaIndex !== -1) {
          const mimePart = url.substring(5, commaIndex);
          const data = url.substring(commaIndex + 1);
          const mimeType = mimePart.split(";")[0];

          parts.push({
            inlineData: { mime_type: mimeType, data: data }
          });
        }
      } else if (item.type === OPENAI_BLOCK.IMAGE_URL && item.image_url?.url && (item.image_url.url.startsWith("http://") || item.image_url.url.startsWith("https://"))) {
        parts.push({
          fileData: { fileUri: item.image_url.url, mimeType: remoteImageMimeType(item.image_url.url) }
        });
      } else if (item.type === OPENAI_BLOCK.INPUT_AUDIO && item.input_audio?.data) {
        const format = item.input_audio.format || "wav";
        const mimeType = format === "mp3" ? "audio/mpeg" : `audio/${format}`;
        parts.push({
          inlineData: { mime_type: mimeType, data: item.input_audio.data }
        });
      } else if (item.type === OPENAI_BLOCK.AUDIO_URL && item.audio_url?.url?.startsWith("data:")) {
        const url = item.audio_url.url;
        const commaIndex = url.indexOf(",");
        if (commaIndex !== -1) {
          const mimePart = url.substring(5, commaIndex);
          const data = url.substring(commaIndex + 1);
          const mimeType = mimePart.split(";")[0];
          parts.push({
            inlineData: { mime_type: mimeType, data: data }
          });
        }
      } else if (item.type === OPENAI_BLOCK.FILE && item.file?.file_data?.startsWith("data:")) {
        const url = item.file.file_data;
        const commaIndex = url.indexOf(",");
        if (commaIndex !== -1) {
          const mimeType = url.substring(5, commaIndex).split(";")[0];
          const data = url.substring(commaIndex + 1);
          parts.push({ inlineData: { mime_type: mimeType, data: data } });
        }
      }
    }
  }

  return parts;
}
export function extractTextContent(content, separator = "") {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(c => c.type === OPENAI_BLOCK.TEXT).map(c => c.text).join(separator);
  }
  return "";
}

export function tryParseJSON(str) {
  return safeParseJSON(str, null);
}

export function generateRequestId() {
  return `agent-${crypto.randomUUID()}`;
}

export function generateSessionId() {
  return crypto.randomUUID() + Date.now().toString();
}

export function generateProjectId() {
  const adjectives = ["useful", "bright", "swift", "calm", "bold"];
  const nouns = ["fuze", "wave", "spark", "flow", "core"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
}

function removeUnsupportedKeywords(obj, keywords) {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      removeUnsupportedKeywords(item, keywords);
    }
    return;
  }

  for (const key of Object.keys(obj)) {
    if (keywords.includes(key) || key.startsWith("x-")) {
      delete obj[key];
      continue;
    }

    const value = obj[key];
    if (value && typeof value === "object") {
      removeUnsupportedKeywords(value, keywords);
    }
  }
}

function convertConstToEnum(obj) {
  if (!obj || typeof obj !== "object") return;

  if (obj.const !== undefined && !obj.enum) {
    obj.enum = [obj.const];
    delete obj.const;
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      convertConstToEnum(value);
    }
  }
}

function convertEnumValuesToStrings(obj) {
  if (!obj || typeof obj !== "object") return;

  if (obj.enum && Array.isArray(obj.enum)) {
    obj.enum = obj.enum.map(v => String(v));
    if (!obj.type) {
      obj.type = "string";
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      convertEnumValuesToStrings(value);
    }
  }
}

function mergeAllOf(obj) {
  if (!obj || typeof obj !== "object") return;

  if (obj.allOf && Array.isArray(obj.allOf)) {
    const merged = {};

    for (const item of obj.allOf) {
      if (item.properties) {
        if (!merged.properties) merged.properties = {};
        Object.assign(merged.properties, item.properties);
      }
      if (item.required && Array.isArray(item.required)) {
        if (!merged.required) merged.required = [];
        for (const req of item.required) {
          if (!merged.required.includes(req)) {
            merged.required.push(req);
          }
        }
      }
    }

    delete obj.allOf;
    if (merged.properties) obj.properties = { ...obj.properties, ...merged.properties };
    if (merged.required) obj.required = [...(obj.required || []), ...merged.required];
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      mergeAllOf(value);
    }
  }
}

function selectBest(items) {
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let score = 0;
    const type = item.type;

    if (type === "object" || item.properties) {
      score = 3;
    } else if (type === "array" || item.items) {
      score = 2;
    } else if (type && type !== "null") {
      score = 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function flattenAnyOfOneOf(obj) {
  if (!obj || typeof obj !== "object") return;

  if (obj.anyOf && Array.isArray(obj.anyOf) && obj.anyOf.length > 0) {
    const nonNullSchemas = obj.anyOf.filter(s => s && s.type !== "null");
    if (nonNullSchemas.length > 0) {
      const bestIdx = selectBest(nonNullSchemas);
      const selected = nonNullSchemas[bestIdx];
      delete obj.anyOf;
      Object.assign(obj, selected);
    }
  }

  if (obj.oneOf && Array.isArray(obj.oneOf) && obj.oneOf.length > 0) {
    const nonNullSchemas = obj.oneOf.filter(s => s && s.type !== "null");
    if (nonNullSchemas.length > 0) {
      const bestIdx = selectBest(nonNullSchemas);
      const selected = nonNullSchemas[bestIdx];
      delete obj.oneOf;
      Object.assign(obj, selected);
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      flattenAnyOfOneOf(value);
    }
  }
}

function pickBestType(obj, types) {
  if (types.length === 0) return "string";
  if (types.length === 1) return types[0];
  if (obj.properties && types.includes("object")) return "object";
  if (obj.items && typeof obj.items === "object" && obj.items.type && types.includes("array")) return "array";
  for (const t of ["string", "number", "integer", "boolean"]) if (types.includes(t)) return t;
  return types[0];
}

function flattenTypeArrays(obj) {
  if (!obj || typeof obj !== "object") return;

  if (obj.type && Array.isArray(obj.type)) {
    const nonNullTypes = obj.type.filter(t => t !== "null");
    obj.type = pickBestType(obj, nonNullTypes);
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      flattenTypeArrays(value);
    }
  }
}

function ensureObjectType(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.properties && !obj.type) obj.type = "object";
  for (const [key, v] of Object.entries(obj)) {
    if (!v || typeof v !== "object") continue;
    if (key === "properties" && !Array.isArray(v)) {
      for (const sub of Object.values(v)) ensureObjectType(sub);
    } else {
      ensureObjectType(v);
    }
  }
}

function convertPrefixItems(obj) {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj.prefixItems) && obj.prefixItems.length > 0) {
    const variants = obj.prefixItems.filter(s => s && s.type !== "null");
    if (!obj.items && variants.length === 1) {
      obj.items = variants[0];
    } else if (!obj.items && variants.length > 1) {
      obj.items = { anyOf: variants };
    }
    delete obj.prefixItems;
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      convertPrefixItems(value);
    }
  }
}

function ensureArrayItems(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.type === "array") {
    if (!obj.items || typeof obj.items !== "object" || Object.keys(obj.items).length === 0) {
      obj.items = { type: "string" };
    } else if (!obj.items.type) {
      obj.items.type = obj.items.properties ? "object" : obj.items.items ? "array" : "string";
    }
  }
  for (const v of Object.values(obj)) if (v && typeof v === "object") ensureArrayItems(v);
}

function enforceTypeConstraints(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;

  if (schema.properties && typeof schema.properties === "object") {
    for (const child of Object.values(schema.properties)) enforceTypeConstraints(child);
  }
  if (schema.items && typeof schema.items === "object") enforceTypeConstraints(schema.items);

  if (typeof schema.type !== "string") return;
  if (schema.type !== "array") delete schema.items;
  if (schema.type !== "object") {
    delete schema.properties;
    delete schema.required;
  }
}

export function cleanJSONSchemaForAntigravity(schema) {
  if (!schema || typeof schema !== "object") return schema;

  let cleaned = schema;

  convertConstToEnum(cleaned);
  convertEnumValuesToStrings(cleaned);

  mergeAllOf(cleaned);
  convertPrefixItems(cleaned);
  flattenAnyOfOneOf(cleaned);
  flattenTypeArrays(cleaned);

  ensureObjectType(cleaned);
  ensureArrayItems(cleaned);

  removeUnsupportedKeywords(cleaned, UNSUPPORTED_SCHEMA_CONSTRAINTS);

  function cleanupRequired(obj) {
    if (!obj || typeof obj !== "object") return;

    if (obj.required && Array.isArray(obj.required) && obj.properties) {
      const validRequired = obj.required.filter(field =>
        Object.prototype.hasOwnProperty.call(obj.properties, field)
      );
      if (validRequired.length === 0) {
        delete obj.required;
      } else {
        obj.required = validRequired;
      }
    }

    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") {
        cleanupRequired(value);
      }
    }
  }

  cleanupRequired(cleaned);

  function addPlaceholders(obj) {
    if (!obj || typeof obj !== "object") return;

    if (Object.keys(obj).length === 0) {
      obj.type = "object";
      obj.properties = {
        reason: {
          type: "string",
          description: "Brief explanation of why you are calling this tool"
        }
      };
      obj.required = ["reason"];
      return;
    }

    if (obj.type === "object") {
      if (!obj.properties || Object.keys(obj.properties).length === 0) {
        obj.properties = {
          reason: {
            type: "string",
            description: "Brief explanation of why you are calling this tool"
          }
        };
        obj.required = ["reason"];
      }
    }

    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") {
        addPlaceholders(value);
      }
    }
  }

  addPlaceholders(cleaned);

  enforceTypeConstraints(cleaned);

  return cleaned;
}

export const GEMINI_RESERVED_RESPONSE_KEYS = { "$ref": "_ref" };

export function sanitizeFunctionResponsePayload(value) {
  if (Array.isArray(value)) return value.map(sanitizeFunctionResponsePayload);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[GEMINI_RESERVED_RESPONSE_KEYS[key] ?? key] = sanitizeFunctionResponsePayload(val);
  }
  return out;
}

function sanitizeFunctionResponsePart(part) {
  const response = part?.functionResponse?.response;
  if (!response || typeof response !== "object") return part;
  return { ...part, functionResponse: { ...part.functionResponse, response: sanitizeFunctionResponsePayload(response) } };
}

function moveFunctionResponsesLast(parts) {
  const responses = parts.filter(p => p.functionResponse);
  if (!responses.length) return parts;
  return [...parts.filter(p => !p.functionResponse), ...responses];
}

export function normalizeGeminiContents(contents, model = null) {
  const frLast = isGemini4Model(model);
  const out = [];
  for (const c of contents || []) {
    if (!c?.role || !Array.isArray(c.parts)) continue;
    const parts = c.parts.filter(p => p && Object.keys(p).length > 0).map(sanitizeFunctionResponsePart);
    if (parts.length === 0) continue;
    const last = out.at(-1);
    if (last?.role === c.role) {
      last.parts.push(...parts);
      if (frLast && c.role === "user") last.parts = moveFunctionResponsesLast(last.parts);
    } else out.push({ ...c, parts: frLast && c.role === "user" ? moveFunctionResponsesLast(parts) : [...parts] });
  }
  if (out.length > 0 && out[0].role !== "user") {
    out.unshift({ role: "user", parts: [{ text: "..." }] });
  }
  if (out.length > 0 && out.at(-1).role === "model") {
    const fnCalls = (out.at(-1).parts || []).filter(p => p && p.functionCall);
    if (fnCalls.length > 0) {
      const responses = fnCalls.map(p => {
        const call = p.functionCall || {};
        const fr = {
          name: call.name || "tool",
          response: { result: "Continue." }
        };
        if (call.id) fr.id = call.id;
        return { functionResponse: fr };
      });
      out.push({ role: "user", parts: responses });
    } else {
      out.push({ role: "user", parts: [{ text: "Continue." }] });
    }
  }
  return out;
}

