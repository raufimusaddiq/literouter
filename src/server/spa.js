import { join } from "node:path";
import { getSettings } from "@/lib/db/index.js";
import { getServerTimeZone } from "@/shared/utils/dateTime";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { cookies } from "./http.js";

const INDEX_PATH = join(import.meta.dir, "..", "web", "index.html");
const UNSAFE_IN_SCRIPT = /[<>&\u2028\u2029]/g;

export function serializeBoot(boot) {
  return JSON.stringify(boot).replace(
    UNSAFE_IN_SCRIPT,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

async function readRequireLogin() {
  try {
    const settings = await getSettings();
    return settings ? settings.requireLogin !== false : true;
  } catch {
    return true;
  }
}

async function buildBoot(req) {
  return {
    timeZone: getServerTimeZone(),
    gaId: process.env.NEXT_PUBLIC_GA_ID || null,
    requireLogin: await readRequireLogin(),
    locale: normalizeLocale(cookies(req).get(LOCALE_COOKIE)),
  };
}

export async function serveSpa(req) {
  const script = `<script>window.__LR_BOOT__=${serializeBoot(await buildBoot(req))}</script>`;
  const html = await new HTMLRewriter()
    .on("head", {
      element(head) {
        head.append(script, { html: true });
      },
    })
    .transform(new Response(Bun.file(INDEX_PATH)))
    .text();
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(html)),
  };
  return new Response(req.method === "HEAD" ? null : html, { status: 200, headers });
}
