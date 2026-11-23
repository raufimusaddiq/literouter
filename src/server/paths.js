import { join, resolve } from "node:path";

export const PUBLIC_DIR = process.env.LITEROUTER_PUBLIC_DIR
  ? resolve(process.env.LITEROUTER_PUBLIC_DIR)
  : join(import.meta.dir, "..", "..", "public");
