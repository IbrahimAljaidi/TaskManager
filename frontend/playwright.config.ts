import { defineConfig, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const baseURL = process.env.TASKFLOW_E2E_URL || "http://127.0.0.1:3000";
mkdirSync(resolve(__dirname, "../docs/verification"), { recursive: true });

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  webServer: process.env.TASKFLOW_E2E_URL ? undefined : {
    command: "node scripts/serve-export.mjs",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
