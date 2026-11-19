import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Separate package with its own build output.
    "cli/app/**",
    // Agent worktrees carry their own copies of the sources.
    ".claude/**",
    ".rig/**",
  ]),
]);

export default eslintConfig;
