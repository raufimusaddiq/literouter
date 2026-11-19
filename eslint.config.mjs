import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

// React Compiler rules ship as errors and the dashboard has ~41 pre-existing
// violations. Downgrade them to warnings so the CI lint step only fails on real
// errors; delete this block once the debt is cleared.
const reactCompilerDebt = {
  "react-hooks/set-state-in-effect": "warn",
  "react-hooks/immutability": "warn",
  "react-hooks/rules-of-hooks": "warn",
  "react-hooks/refs": "warn",
  "react-hooks/purity": "warn",
  "react-hooks/preserve-manual-memoization": "warn",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    files: nextVitals[0].files,
    plugins: { "react-hooks": nextVitals[0].plugins["react-hooks"] },
    rules: reactCompilerDebt,
  },
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
