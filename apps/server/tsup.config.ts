import { copyFile } from "node:fs/promises";
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  async onSuccess() {
    await copyFile("src/documents/pdf-worker.mjs", "dist/pdf-worker.mjs");
  },
  external: ["@electric-sql/pglite"],
  noExternal: ["@memlia/contracts"],
});
