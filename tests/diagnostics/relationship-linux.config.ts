import { defineConfig, mergeConfig } from "vitest/config";
import ordinary from "../../vitest.config.js";
// Exact original bodies/fixtures/assertions and 30s / explicit 20s and 15s limits.
export default mergeConfig(
  ordinary,
  defineConfig({
    test: { setupFiles: ["tests/diagnostics/relationship-linux.setup.ts"] },
  }),
);
