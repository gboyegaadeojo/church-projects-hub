import type { D1Migration } from "cloudflare:test";

// Bindings added for tests only (vitest.config.ts).
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
