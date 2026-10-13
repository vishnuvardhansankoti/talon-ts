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
    ignores: ["**/dist/**", "**/generated/**", "**/node_modules/**", "**/pkg-build/**"],
  },
);
