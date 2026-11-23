import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const root = process.env.REPO_ROOT;

function resolveFile(base) {
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, path.join(base, "index.js")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function toResolved(file) {
  return { url: pathToFileURL(file).href, shortCircuit: true };
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const file = resolveFile(path.join(root, "src", specifier.slice(2)));
    if (file) return toResolved(file);
  }
  if (specifier === "open-sse" || specifier.startsWith("open-sse/")) {
    const file = resolveFile(path.join(root, specifier));
    if (file) return toResolved(file);
  }
  if (context.parentURL?.startsWith("file:") && (specifier.startsWith("./") || specifier.startsWith("../"))) {
    const parent = new URL(specifier, context.parentURL);
    const file = resolveFile(parent.pathname);
    if (file) return toResolved(file);
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && !specifier.startsWith(".") && !specifier.endsWith(".js")) return nextResolve(`${specifier}.js`, context);
    throw error;
  }
}
