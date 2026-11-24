import { getSettings } from "@/lib/db/index.js";
import { getServerTimeZone } from "@/shared/utils/dateTime";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { headExtras } from "@/web/head.js";
import { cookies } from "./http.js";
import { getSpa, spaUnavailableResponse } from "./spaBuild.js";

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

function publicOrigin(req) {
  try {
    const url = new URL(req.url);
    const proto = req.headers.get("x-forwarded-proto") === "https" ? "https:" : url.protocol;
    return `${proto}//${url.host}`;
  } catch {
    return null;
  }
}

export async function serveSpa(req) {
  let spa;
  try {
    spa = await getSpa();
  } catch (error) {
    return spaUnavailableResponse(error);
  }
  const boot = await buildBoot(req);
  const script = `<script>window.__LR_BOOT__=${serializeBoot(boot)}</script>`;
  const html = await new HTMLRewriter()
    .on("head", {
      element(head) {
        head.append(headExtras({ gaId: boot.gaId, origin: publicOrigin(req) }), { html: true });
        head.append(script, { html: true });
      },
    })
    .transform(new Response(spa.indexHtml, { headers: { "content-type": "text/html; charset=utf-8" } }))
    .text();
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(html)),
  };
  return new Response(req.method === "HEAD" ? null : html, { status: 200, headers });
}
