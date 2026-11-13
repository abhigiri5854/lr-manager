import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// Same env files the app reads (.env.local → dev database).
loadEnvConfig(process.cwd());

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

// These tests create and settle real records. Only ever run them against a local server.
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) {
  throw new Error(`e2e refuses to run against ${baseURL}: baseURL must be localhost.`);
}

export default defineConfig({
  testDir: "e2e",
  outputDir: "final-check/e2e",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
