import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: [4173, 4175].map((port) => ({
    command: "npx tsx tests/e2e/serve.ts",
    url: `http://127.0.0.1:${port}`,
    env: {
      MEMLIA_TEST_WEB_PORT: String(port),
      MEMLIA_TEST_API_PORT: String(port + 1),
    },
    reuseExistingServer: false,
    timeout: 60000,
  })),
});
