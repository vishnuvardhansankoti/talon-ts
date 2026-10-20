import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    plugins: { boundaries },
    settings: {
      "boundaries/include": ["packages/**/*.ts", "apps/**/*.ts"],
      "boundaries/elements": [
        { type: "core", pattern: "packages/agent-core/src/**" },
        { type: "package", pattern: "packages/*/src/**" },
        { type: "app", pattern: "apps/*/src/**" },
      ],
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: "app", allow: ["package", "core"] },
            { from: "package", allow: ["core"] },
            // agent-core depends on nothing concrete outside itself (§2.3) —
            // it only sees sibling packages through its own port interfaces.
            { from: "core", allow: [] },
          ],
        },
      ],
    },
  },
  {
    // Metro/Babel require these two as plain CommonJS — apps/mobile's own
    // package.json has no "type": "module", so Node (and these tools)
    // already treat them as CJS regardless of the workspace root's own
    // "type": "module"; this override just gives lint the matching
    // globals instead of flagging the CJS syntax those tools mandate.
    files: ["apps/mobile/babel.config.js", "apps/mobile/metro.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "writable", require: "readonly", __dirname: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    ignores: ["**/dist/**", "**/generated/**", "**/node_modules/**", "**/pkg-build/**"],
  },
);
