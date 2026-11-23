const SURROGATE_ESCAPE = /\\ud[89a-f][0-9a-f]{2}/i;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

const wellFormed = (_key, value) => (typeof value === "string" ? value.replace(LONE_SURROGATE, "�") : value);

export function stringifyWellFormed(value) {
  const text = JSON.stringify(value);
  if (typeof text !== "string" || !SURROGATE_ESCAPE.test(text)) return text;
  return JSON.stringify(value, wellFormed);
}
