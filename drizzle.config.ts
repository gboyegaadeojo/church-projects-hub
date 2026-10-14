import { defineConfig } from "drizzle-kit";

// Generates SQL migrations into migrations/ for Wrangler to apply (section 18).
export default defineConfig({
  dialect: "sqlite",
  schema: "./worker/db/schema.ts",
  out: "./migrations",
});
