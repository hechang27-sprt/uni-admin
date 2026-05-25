import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "error",
    suspicious: "warn",
    perf: "warn",
    style: "off", // Leave stylistic formatting to oxfmt or Prettier
  },
  plugins: ["typescript", "vue", "unicorn", "oxc", "vitest", "promise"],
  rules: {
    "unicorn/no-useless-iterator-to-array": "error",
    "unicorn/no-useless-spread": "error",
  },
});
