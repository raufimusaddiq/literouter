import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import noComments from "./eslint-rules/no-comments.mjs";

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
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    plugins: { local: { rules: { "no-comments": noComments } } },
    rules: { "local/no-comments": "error" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "cli/app/**",
    ".claude/**",
    ".rig/**",
  ]),
]);

export default eslintConfig;
