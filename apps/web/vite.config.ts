import tailwindcss from "@tailwindcss/postcss";
import { defineConfig } from "vite";
import { resolve } from "node:path";
import { distributeNotices } from "./notices.ts";
import { wrapInTwentyUiCascadeLayer } from "../../packages/ui/vendor/build-tools/wrapInTwentyUiCascadeLayer.ts";
const source = resolve(import.meta.dirname, "../../packages/ui/vendor/src");
export default defineConfig({
  root: resolve(import.meta.dirname),
  resolve: { alias: { "@ui": source } },
  css: {
    modules: { localsConvention: "camelCaseOnly" },
    postcss: {
      plugins: [
        tailwindcss(),
        wrapInTwentyUiCascadeLayer({ sourceDirectory: source }),
      ],
    },
    preprocessorOptions: {
      scss: {
        loadPaths: [resolve(source, "styles")],
        additionalData:
          "@use 'abstracts/functions' as *;\n@use 'abstracts/mixins' as *;\n@use 'abstracts/breakpoints' as *;\n",
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: { "/api": process.env.MEMLIA_API_ORIGIN ?? "http://127.0.0.1:4174" },
  },
  build: {
    rolldownOptions: {
      onwarn(warning, defaultHandler) {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE") defaultHandler(warning);
      },
    },
  },
  plugins: [
    {
      name: "distributed-notices",
      closeBundle: distributeNotices,
    },
  ],
});
