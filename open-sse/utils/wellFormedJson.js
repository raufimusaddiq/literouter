// JSON.stringify writes a lone UTF-16 surrogate (a split emoji, e.g. from truncating a
// string at a code-unit boundary) as a bare \udXXX escape. Strict upstream parsers
// reject it ("invalid JSON: lone leading surrogate in hex escape" - kenari, 400).
// Replace such code units with U+FFFD before the body leaves the gateway.
const SURROGATE_ESCAPE = /\\ud[89a-f][0-9a-f]{2}/i;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

const wellFormed = (_key, value) => (typeof value === "string" ? value.replace(LONE_SURROGATE, "�") : value);

export function stringifyWellFormed(value) {
  const text = JSON.stringify(value);
  // Fast path: nothing surrogate-shaped in the output, so nothing to repair.
  if (typeof text !== "string" || !SURROGATE_ESCAPE.test(text)) return text;
  return JSON.stringify(value, wellFormed);
}
