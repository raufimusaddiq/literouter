import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(import.meta.dir));
const FONT_DIR = join("src", "web", "fonts");
const NAMES_FILE = join(FONT_DIR, "material-symbols-names.txt");
const ICONS_FILE = join(FONT_DIR, "material-symbols-icons.json");
const FONT_FILE = join(FONT_DIR, "material-symbols-outlined.woff2");
const CODEPOINTS_URL =
  "https://raw.githubusercontent.com/google/material-design-icons/master/variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints";
const CSS_URL = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,300,0,0&icon_names=";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const SOURCES = ["src/**/*.{js,jsx,mjs}", "open-sse/**/*.{js,jsx,mjs}"];
const TOKEN = /["'`>]\s*([a-z0-9_]+)\s*["'`<]/g;

export function readSymbolNames({ root = ROOT } = {}) {
  return new Set(readFileSync(join(root, NAMES_FILE), "utf8").split("\n").filter(Boolean));
}

export function readFontIcons({ root = ROOT } = {}) {
  return JSON.parse(readFileSync(join(root, ICONS_FILE), "utf8"));
}

export function collectIcons({ root = ROOT, names = readSymbolNames({ root }) } = {}) {
  const found = new Set();
  for (const pattern of SOURCES) {
    for (const file of new Bun.Glob(pattern).scanSync(root)) {
      for (const match of readFileSync(join(root, file), "utf8").matchAll(TOKEN)) {
        if (names.has(match[1])) found.add(match[1]);
      }
    }
  }
  return [...found].sort();
}

async function fetchOk(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res;
}

async function generate() {
  const codepoints = await (await fetchOk(CODEPOINTS_URL)).text();
  const names = [...new Set(codepoints.split("\n").map((line) => line.split(" ")[0]).filter(Boolean))].sort();
  writeFileSync(join(ROOT, NAMES_FILE), `${names.join("\n")}\n`);
  const icons = collectIcons({ names: new Set(names) });
  const css = await (await fetchOk(CSS_URL + icons.join(","), { headers: { "user-agent": BROWSER_UA } })).text();
  const fontUrl = css.match(/src:\s*url\(([^)]+)\)\s*format\('woff2'\)/)?.[1];
  if (!fontUrl) throw new Error("no woff2 url in the Google Fonts response");
  const font = new Uint8Array(await (await fetchOk(fontUrl)).arrayBuffer());
  writeFileSync(join(ROOT, FONT_FILE), font);
  writeFileSync(join(ROOT, ICONS_FILE), `${JSON.stringify(icons, null, 2)}\n`);
  console.log(`${icons.length} icons, ${font.byteLength} bytes`);
}

if (import.meta.main) await generate();
