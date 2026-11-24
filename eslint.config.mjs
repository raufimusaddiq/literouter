import { defineConfig, globalIgnores } from "eslint/config";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import importPlugin from "eslint-plugin-import";
import globals from "globals";
import noComments from "./eslint-rules/no-comments.mjs";

const reactSources = [
  "src/web/**/*.{js,jsx}",
  "src/shared/components/**/*.{js,jsx}",
  "src/shared/hooks/**/*.{js,jsx}",
  "src/store/**/*.js",
  "src/i18n/**/*.js",
];

const eslintConfig = defineConfig([
  {
    name: "literouter/react",
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    plugins: {
      react,
      import: importPlugin,
      "jsx-a11y": jsxA11y,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      "import/no-anonymous-default-export": "warn",
      "react/no-unknown-property": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/jsx-no-target-blank": "off",
      "jsx-a11y/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
    },
  },
  {
    name: "literouter/react-hooks",
    files: reactSources,
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    name: "literouter/cli-entry",
    files: ["cli/cli.js"],
    languageOptions: { sourceType: "commonjs" },
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    plugins: { local: { rules: { "no-comments": noComments } } },
    rules: { "local/no-comments": "error" },
  },
  {
    files: [
      "open-sse/providers/REGISTRY_TEMPLATE.js",
      "open-sse/providers/registry/index.js",
      "src/shared/constants/providerIconManifest.js",
    ],
    rules: { "local/no-comments": "off" },
  },
  globalIgnores([
    "dist/**",
    "out/**",
    "build/**",
    "cli/app/**",
    ".claude/**",
    ".rig/**",
  ]),
]);

export default eslintConfig;
