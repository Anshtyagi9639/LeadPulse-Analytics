import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const API_PORT = 4180;
const WEB_PORT = 3180;
const tmp = path.join(os.tmpdir(), "leadpulse-e2e");

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000, // full workflows upload, process and download several files
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    acceptDownloads: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      // Backend without an OpenAI key, to verify the portal works without AI.
      command: "npm run start -w backend",
      url: `http://localhost:${API_PORT}/api/health`,
      env: { PORT: String(API_PORT), CORS_ORIGINS: `http://localhost:${WEB_PORT}`, TEMP_DIR: path.join(tmp, "sessions"), CONFIG_DIR: path.join(tmp, "config"), OPENAI_API_KEY: "" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Built beforehand by e2e/build.mjs (see the test:e2e script).
      command: `npm run start -w frontend -- -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      env: { NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
