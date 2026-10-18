import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["apps/server/test/**/*.test.ts", "apps/web/test/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
