export const BUILD_HEADER = "x-literouter-build";

const ENTRY_PATTERN = /\bsrc=["'](\/assets\/index-[^"']+\.js)["']/;

export function extractEntry(html) {
  return ENTRY_PATTERN.exec(html)?.[1] ?? null;
}
