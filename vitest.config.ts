import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The real migrations, applied to the test D1 by test/setup.ts.
const migrations = await readD1Migrations("./migrations");

// Tests are named after requirement IDs (docs/REQUIREMENTS.md section 17).
// - worker: API and data tests in the real Workers runtime (Miniflare) with local D1 and R2.
// - ui: React component tests in jsdom.
// End-to-end and axe checks run in a real browser with Playwright (playwright.config.ts).
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              // Test-only values so the suite runs the same in CI (no .dev.vars there). Not real secrets.
              bindings: {
                TEST_MIGRATIONS: migrations,
                GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
                GOOGLE_CLIENT_SECRET: "test-client-secret",
                GOOGLE_REDIRECT_URI: "https://hub.test/api/auth/callback",
                SESSION_SECRET: "test-session-secret-not-for-production-use-0000",
                // Blank here even when a developer's .dev.vars has real keys: tests never call Resend or the
                // Cloudflare analytics API, and they run the same on every machine.
                RESEND_API_KEY: "",
                CF_ACCOUNT_ID: "",
                CF_ANALYTICS_TOKEN: "",
              },
            },
          }),
        ],
        test: {
          name: "worker",
          include: ["test/**/*.test.ts"],
          setupFiles: ["./test/setup.ts"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          setupFiles: ["./src/test/setup.ts"],
        },
      },
    ],
  },
});
