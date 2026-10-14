import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside the real Workers runtime (Miniflare) with local D1 and R2.
// Tests are named after requirement IDs (docs/REQUIREMENTS.md section 17).
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
