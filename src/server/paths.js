import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "..", "..");

export const PUBLIC_DIR = process.env.LITEROUTER_PUBLIC_DIR
  ? resolve(process.env.LITEROUTER_PUBLIC_DIR)
  : join(REPO_ROOT, "public");

export const SPA_DIR_OVERRIDE = process.env.LITEROUTER_SPA_DIR
  ? resolve(process.env.LITEROUTER_SPA_DIR)
  : null;

export const SPA_DIR = SPA_DIR_OVERRIDE ?? join(REPO_ROOT, "dist", "web");
