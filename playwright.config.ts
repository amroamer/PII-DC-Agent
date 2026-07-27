import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5080",
    headless: true,
    screenshot: "on",
    trace: "retain-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },
});
