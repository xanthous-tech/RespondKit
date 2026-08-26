import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const localChromium = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    launchOptions: existsSync(localChromium) ? { executablePath: localChromium } : {},
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "mobile-chromium",
      use: {
        deviceScaleFactor: 1,
        hasTouch: true,
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    command: "pnpm exec vp dev --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
