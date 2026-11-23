import { GlobalRegistrator } from "@happy-dom/global-registrator";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outdir = process.argv[2];
const entry = process.argv[3];

GlobalRegistrator.register({ url: "http://localhost/login" });
document.body.innerHTML = '<div id="root"></div>';
globalThis.IS_REACT_ACT_ENVIRONMENT = false;

Bun.plugin({
  name: "dist-root",
  setup(build) {
    build.onResolve({ filter: /^\/assets\// }, (args) => ({
      path: path.join(outdir, args.path),
    }));
  },
});

const realProcess = globalThis.process;
delete globalThis.process;

const report = { processHidden: typeof globalThis.process === "undefined", ok: true };
try {
  await import(pathToFileURL(path.join(outdir, entry)).href);
  await new Promise((resolve) => setTimeout(resolve, 300));
} catch (error) {
  report.ok = false;
  report.name = error?.name;
  report.message = String(error?.message ?? error);
}
globalThis.process = realProcess;
console.log(`RESULT ${JSON.stringify(report)}`);
