import { defineConfig, devices } from "@playwright/test";

const authFile = "tests/.auth/user.json";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm run dev:web -- --hostname localhost --port 3000",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        headless: false,
        ignoreHTTPSErrors: true,
        launchOptions: {
          args: ["--disable-blink-features=AutomationControlled"],
          ignoreDefaultArgs: ["--enable-automation"]
        }
      }
    },
    {
      name: "chromium",
      testIgnore: [/.*\.setup\.ts/, /.*authenticated\.spec\.ts/],
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "chromium-auth",
      testMatch: /.*authenticated\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: authFile
      }
    }
  ]
});
