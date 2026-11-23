import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const tracingRoot = process.env.NEXT_TRACING_ROOT_MODE === "workspace"
  ? join(projectRoot, "..")
  : projectRoot;
const proxyClientMaxBodySize = process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE || "128mb";

const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "sql.js", "node:sqlite", "bun:sqlite", "open"],
  turbopack: {
    root: tracingRoot
  },
  outputFileTracingRoot: tracingRoot,
  outputFileTracingExcludes: {
    "*": ["./tests/**/*", "./docs/**/*", "./cli/**/*", "./.rig/**/*", "./.claude/**/*", "./images/**/*", "./Dockerfile", "./*.md"],
    "/instrumentation": ["./tests/**/*", "./docs/**/*", "./cli/**/*", "./.rig/**/*", "./.claude/**/*", "./images/**/*", "./Dockerfile", "./*.md"],
    "/middleware": ["./tests/**/*", "./docs/**/*", "./cli/**/*", "./.rig/**/*", "./.claude/**/*", "./images/**/*", "./Dockerfile", "./*.md"],
  },
  images: {
    unoptimized: true
  },
  env: {},
  experimental: {
    proxyClientMaxBodySize,
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
  },
  async rewrites() {
    return [
      {
        source: "/v1/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1/v1",
        destination: "/api/v1"
      },
      {
        source: "/codex/:path*",
        destination: "/api/v1/responses"
      },
      {
        source: "/responses",
        destination: "/api/v1/responses"
      },
      {
        source: "/v1beta/:path*",
        destination: "/api/v1beta/:path*"
      },
      {
        source: "/v1beta",
        destination: "/api/v1beta"
      },
      {
        source: "/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1",
        destination: "/api/v1"
      }
    ];
  }
};

export default nextConfig;
