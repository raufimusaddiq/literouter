import { BUILD_HEADER } from "@/shared/utils/buildEntry.js";
import { currentBuildEntry } from "./spaBuild.js";

export async function withBuildHeader(req, res) {
  const { pathname } = new URL(req.url);
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return res;
  const entry = await currentBuildEntry();
  if (!entry) return res;
  try {
    res.headers.set(BUILD_HEADER, entry);
  } catch {
    return res;
  }
  return res;
}
