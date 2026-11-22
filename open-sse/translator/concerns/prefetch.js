import { FORMATS } from "../formats.js";
import { fetchImageAsBase64, parseDataUri, assertImageCount, createImageByteBudget, dataUriBytes } from "./image.js";

const TARGETS_NEED_BASE64 = new Set([
  FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX,
  FORMATS.ANTIGRAVITY, FORMATS.OLLAMA, FORMATS.KIRO,
  FORMATS.COMMANDCODE,
]);

export const PREFETCH_CONCURRENCY = 4;
const PREFETCH_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 60000;
const CACHE_MAX_ENTRIES = 16;
const imageCache = new Map();

export function clearPrefetchCacheForTests() { imageCache.clear(); }

async function cachedFetch(url, options) {
  const now = Date.now();
  const hit = imageCache.get(url);
  if (hit) {
    imageCache.delete(url);
    if (hit.expiresAt > now) { imageCache.set(url, hit); return hit.value; }
  }
  const value = await fetchImageAsBase64(url, options);
  if (value && !options.signal?.aborted) {
    while (imageCache.size >= CACHE_MAX_ENTRIES) imageCache.delete(imageCache.keys().next().value);
    imageCache.set(url, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return value;
}

function isRemoteUrl(url) {
  return typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
}

function collectImageRefs(body, sourceFormat) {
  const refs = [];
  const pushOpenAI = (messages) => {
    for (const msg of messages || []) {
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block?.type === "image_url") {
          const url = typeof block.image_url === "string" ? block.image_url : block.image_url?.url;
          if (isRemoteUrl(url)) refs.push({ get: () => url, set: (v) => {
            if (typeof block.image_url === "string") block.image_url = v; else block.image_url.url = v;
          } });
        }
      }
    }
  };
  const pushGemini = (contents) => {
    for (const c of contents || []) {
      for (const p of c.parts || []) {
        const uri = p?.fileData?.fileUri;
        if (isRemoteUrl(uri)) refs.push({ get: () => uri, part: p });
      }
    }
  };

  switch (sourceFormat) {
    case FORMATS.OPENAI:
    case FORMATS.OLLAMA:
    case FORMATS.KIRO:
    case FORMATS.CURSOR:
    case FORMATS.COMMANDCODE:
      pushOpenAI(body.messages);
      break;
    case FORMATS.CLAUDE:
      for (const msg of body.messages || []) {
        if (!Array.isArray(msg.content)) continue;
        for (const block of msg.content) {
          if (block?.type === "image" && block.source?.type === "url" && isRemoteUrl(block.source.url)) {
            refs.push({ get: () => block.source.url, claudeBlock: block });
          }
        }
      }
      break;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
      pushGemini(body.contents);
      break;
    case FORMATS.ANTIGRAVITY:
      pushGemini(body?.request?.contents);
      break;
    default:
      pushOpenAI(body.messages);
  }
  return refs;
}

export async function prefetchRemoteImages(body, sourceFormat, targetFormat, options = {}) {
  if (!body || !TARGETS_NEED_BASE64.has(targetFormat)) return 0;
  const refs = collectImageRefs(body, sourceFormat);
  if (!refs.length) return 0;

  const pending = [];
  const byUrl = new Map();
  for (const ref of refs) {
    const url = ref.get();
    if (parseDataUri(url)) continue;
    if (!byUrl.has(url)) { byUrl.set(url, []); pending.push(url); }
    byUrl.get(url).push(ref);
  }

  assertImageCount(pending.length);
  const budget = createImageByteBudget();

  const signal = options.signal;
  const fetchOpts = { ...options, signal: (() => { const t = AbortSignal.timeout(options.timeoutMs ?? PREFETCH_TIMEOUT_MS); return signal ? AbortSignal.any([signal, t]) : t; })() };
  const results = new Map();
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      if (signal?.aborted) return;
      const url = pending[next++];
      const value = await cachedFetch(url, fetchOpts);
      if (value) budget.add(dataUriBytes(value.url));
      results.set(url, value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PREFETCH_CONCURRENCY, pending.length) }, worker));

  let converted = 0;
  for (const [url, urlRefs] of byUrl) {
    const fetched = results.get(url);
    if (!fetched) continue;
    for (const ref of urlRefs) {
      if (ref.set) ref.set(fetched.url);
      else if (ref.part) { delete ref.part.fileData; ref.part.inlineData = { mimeType: fetched.mimeType, data: fetched.url.split(",")[1] }; }
      else if (ref.claudeBlock) ref.claudeBlock.source = { type: "base64", media_type: fetched.mimeType, data: fetched.url.split(",")[1] };
      converted++;
    }
  }
  return converted;
}
