import { serveStatic } from "../../../src/server/static.js";
import { PUBLIC_DIR, SPA_DIR, isCompiled } from "../../../src/server/paths.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

const paths = ["/favicon.svg", "/assets/app-abc.js", "/assets/missing.js", "/assets/..%2findex.html"];
const results = {};
for (const path of paths) {
  const res = await serveStatic(new Request(`http://localhost${path}`));
  results[path] = res ? { status: res.status, cache: res.headers.get("cache-control"), body: (await res.text()).slice(0, 20) } : null;
}
console.log(JSON.stringify({
  isCompiled,
  publicDir: PUBLIC_DIR,
  spaDir: SPA_DIR,
  hasIndex: existsSync(join(SPA_DIR, "index.html")),
  results,
}));
