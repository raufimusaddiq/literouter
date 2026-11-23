import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");

const tailwind = {
  name: "tailwind",
  async setup(build) {
    const { default: plugin } = await import("bun-plugin-tailwind");
    await plugin.setup(build);
  },
};

function fontAssets(outdir) {
  return {
    name: "font-assets",
    setup(build) {
      const pending = new Map();
      build.onResolve({ filter: /\.woff2$/ }, (args) => {
        if (/^(https?:|data:|\/assets\/)/.test(args.path)) return;
        const resolved = args.path.startsWith(".")
          ? resolve(args.resolveDir, args.path)
          : Bun.resolveSync(args.path, args.resolveDir);
        const bytes = readFileSync(resolved);
        const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
        const stem = basename(resolved, ".woff2");
        const filename = `${stem}-${hash}.woff2`;
        pending.set(filename, bytes);
        return { path: `/assets/${filename}`, external: true };
      });
      build.onEnd((result) => {
        if (!result?.success || pending.size === 0) return;
        const assetsDir = join(outdir, "assets");
        mkdirSync(assetsDir, { recursive: true });
        for (const [filename, bytes] of pending) {
          writeFileSync(join(assetsDir, filename), bytes);
        }
      });
    },
  };
}

export function webBuildOptions({ production, outdir }) {
  const options = {
    entrypoints: [join(ROOT, "src", "web", "index.html")],
    outdir,
    splitting: true,
    publicPath: "/",
    naming: {
      entry: "[dir]/[name].[ext]",
      chunk: "assets/[name]-[hash].[ext]",
      asset: "assets/[name]-[hash].[ext]",
    },
    metafile: true,
    target: "browser",
    plugins: [fontAssets(outdir), tailwind],
    define: { "process.env": "{}" },
  };
  if (production) {
    options.minify = true;
    options.define["process.env.NODE_ENV"] = '"production"';
  } else {
    options.sourcemap = "linked";
  }
  return options;
}

export async function buildWeb({ production = true, outdir = "dist/web" } = {}) {
  const absoluteOutdir = resolve(outdir);
  const result = await Bun.build(webBuildOptions({ production, outdir: absoluteOutdir }));
  if (!result.success) {
    throw new Error(result.logs.map((log) => log.message ?? String(log)).join("\n"));
  }
  return {
    outdir: absoluteOutdir,
    indexHtml: join(absoluteOutdir, "index.html"),
    metafile: result.metafile,
  };
}
