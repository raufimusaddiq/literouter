import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "..", "..");

export const isCompiled = /\$bunfs|~BUN/.test(import.meta.dir);

export const isBundled = process.env.LITEROUTER_BUNDLED === "1";

const packaged = isCompiled || isBundled;

export const PUBLIC_DIR = process.env.LITEROUTER_PUBLIC_DIR
  ? resolve(process.env.LITEROUTER_PUBLIC_DIR)
  : packaged
    ? join(import.meta.dir, "public")
    : join(REPO_ROOT, "public");

export const SPA_DIR_OVERRIDE = process.env.LITEROUTER_SPA_DIR
  ? resolve(process.env.LITEROUTER_SPA_DIR)
  : null;

export const SPA_DIR = SPA_DIR_OVERRIDE ?? (packaged ? join(import.meta.dir, "web") : join(REPO_ROOT, "dist", "web"));

export function assertBundleCwd() {}
