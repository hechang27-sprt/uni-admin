import tailwindcss from "@tailwindcss/vite";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  vite: { plugins: [tailwindcss()] },
  css: ["./app/assets/css/main.css"],
  modules: ["@pinia/nuxt"],
  typescript: {
    nodeTsConfig: {
      compilerOptions: {
        types: ["bun"],
      },
      include: ["../drizzle.config.ts", "../scripts/**/*.ts"],
    },
  },
});
