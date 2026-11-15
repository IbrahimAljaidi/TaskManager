import { defineConfig, devices } from "@playwright/test";
const baseURL = process.env.TASKFLOW_E2E_URL || "http://127.0.0.1:3000";
export default defineConfig({ testDir: "./e2e", use: { baseURL, ...devices["Desktop Chrome"], channel: process.env.CI ? undefined : "chrome" }, webServer: process.env.TASKFLOW_E2E_URL ? undefined : { command: "npm run dev -- --hostname 127.0.0.1", url: baseURL, reuseExistingServer: true, timeout: 120000 } });
