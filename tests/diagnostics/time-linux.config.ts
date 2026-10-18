import { defineConfig, mergeConfig } from "vitest/config";
import ordinary from "../../vitest.config.js";

// Exact original 30s test/hook limits and test source. Additional diagnostics
// have their own process; neither this file nor the observer is a normal gate.
export default mergeConfig(
  ordinary,
  defineConfig({
    test: { setupFiles: ["tests/diagnostics/time-linux.setup.ts"] },
  }),
);
