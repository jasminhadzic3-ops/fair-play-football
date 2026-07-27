import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "html" : "list",
  outputDir: process.env.CI ? "test-results" : "/tmp/fair-play-football-playwright-results",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command:
      "EMAIL_ENABLE_NEW_GAME=false EMAIL_ENABLE_GAME_CANCELLED=false EMAIL_ENABLE_GAME_HALF_FULL=false EMAIL_ENABLE_GAME_REMINDER=false EMAIL_DRY_RUN=true npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
});
