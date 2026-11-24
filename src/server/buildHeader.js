import { BUILD_HEADER } from "@/shared/utils/buildEntry.js";
import { currentBuildEntry } from "./spaBuild.js";

export async function withBuildHeader(req, res, startedAt = performance.now()) {
  const { pathname } = new URL(req.url);
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return res;
  const entry = await currentBuildEntry();
  try {
    res.headers.append("server-timing", `app;dur=${(performance.now() - startedAt).toFixed(1)}`);
    if (entry) res.headers.set(BUILD_HEADER, entry);
  } catch {
    return res;
  }
  return res;
}
