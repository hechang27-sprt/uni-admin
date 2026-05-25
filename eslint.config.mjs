// @ts-check
import withNuxt from "./.nuxt/eslint.config.mjs";
import oxlint from "eslint-plugin-oxlint";
import unicorn from "eslint-plugin-unicorn";

export default withNuxt(
  {
    plugins: {
      unicorn,
    },
  },
  unicorn.configs.recommended,
  ...oxlint.configs["flat/recommended"],
  ...oxlint.configs["flat/vue"],
  {
    rules: {
      "unicorn/no-null": "off",
      "unicorn/prevent-abbreviations": "off",
    },
  },
);
