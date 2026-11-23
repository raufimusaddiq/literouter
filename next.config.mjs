import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const tracingRoot = process.env.NEXT_TRACING_ROOT_MODE === "workspace"
  ? join(projectRoot, "..")
  : projectRoot;

const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  turbopack: {
    root: tracingRoot
  },
  outputFileTracingRoot: tracingRoot,
  outputFileTracingExcludes: {
    "*": ["./tests/**/*", "./docs/**/*", "./cli/**/*", "./.rig/**/*", "./.claude/**/*", "./images/**/*", "./Dockerfile", "./*.md"],
  },
  images: {
    unoptimized: true
  },
  env: {},
  experimental: {
    serverComponentsHmrCache: true,
    optimizePackageImports: ["@xyflow/react", "@dnd-kit/core", "@dnd-kit/sortable"],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    config.watchOptions = {
      ...config.watchOptions,
      aggregateTimeout: 300,
      ignored: /[\\/](node_modules|\.git|logs|\.next|\.next-cli-build|cli|open-sse\.old|tests|docs)[\\/]/,
    };
    return config;
  }
};

export default nextConfig;
