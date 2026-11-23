import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");

const tailwind = {
  name: "tailwind",
  async setup(build) {
    const { default: plugin } = await import("bun-plugin-tailwind");
    await plugin.setup(build);
  },
};

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
    plugins: [tailwind],
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
