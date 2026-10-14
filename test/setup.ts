import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Apply the real migrations to the test database before any test runs. Idempotent.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
