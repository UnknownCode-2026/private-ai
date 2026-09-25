import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    launchOptions: { executablePath: process.env.TEST_BROWSER_PATH },
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node tests/upstream.mjs",
      port: 3101,
      reuseExistingServer: false,
    },
    {
      command: "npm start -- --port 3100 --hostname 127.0.0.1",
      port: 3100,
      reuseExistingServer: false,
      env: {
        PRIVATE_AI_PIN: "local-test-only",
        KOB_AI_API_KEY: "local-test-only",
        KOB_AI_BASE_URL: "http://127.0.0.1:3101/v1",
      },
    },
  ],
});
