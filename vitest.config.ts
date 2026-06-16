import { defineConfig } from "vitest/config";
import { defineVitestProject } from "@nuxt/test-utils/config";
import { fileURLToPath } from "node:url";
import Unimport from "unimport/unplugin";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
    },
    projects: [
      {
        plugins: [
          Unimport.vite({
            imports: [
              { name: "createInMemoryDb", from: "#server/utils/kysely" },
              { name: "pivotToColumns", from: "#server/utils/pivot" },
              { name: "unnest", from: "#server/utils/unnest" },
            ],
          }),
        ],
        resolve: {
          alias: {
            "#server": fileURLToPath(new URL("server", import.meta.url)),
          },
        },
        test: {
          name: "unit",
          include: ["test/unit/**/*.{test,spec}.ts"],
          environment: "node",
          testTimeout: 15_000,
        },
      },
      {
        test: {
          name: "e2e",
          include: ["test/e2e/**/*.{test,spec}.ts"],
          environment: "node",
        },
      },
      await defineVitestProject({
        test: {
          name: "nuxt",
          include: ["test/nuxt/**/*.{test,spec}.ts"],
          environment: "nuxt",
        },
      }),
    ],
  },
});
