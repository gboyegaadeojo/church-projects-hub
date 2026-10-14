import { defineConfig, devices } from "@playwright/test";

// End-to-end and accessibility tests in a real browser (docs/REQUIREMENTS.md section 17).
// Runs against its own dev server on port 5179 (the only place /dev/components exists), so it never
// picks up another app already running on the usual 5174.
const PORT = 5179;
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // The dev server (Vite + workerd) is shared by every test; more workers than this overloads it locally.
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 800 }, hasTouch: true } },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
