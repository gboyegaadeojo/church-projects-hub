import { cloudflareTest } from "@cloudflare/vitest-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

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
          }),
        ],
        test: {
          name: "worker",
          include: ["test/**/*.test.ts"],
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
