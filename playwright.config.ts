import { defineConfig, devices } from "@playwright/test";

const authFile = "tests/.auth/user.json";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const useLocalWebServer = /^https?:\/\/localhost(?::\d+)?$/i.test(baseURL);

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup-auth.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  webServer: useLocalWebServer
    ? {
        command: "npm run dev:web -- --hostname localhost --port 3000",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000
      }
    : undefined,
  projects: [
    {
      name: "chromium",
      testIgnore: [/.*authenticated\.spec\.ts/, /.*\.setup\.ts/],
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "chromium-auth",
      testMatch: /.*authenticated\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: authFile
      }
    }
  ]
});
