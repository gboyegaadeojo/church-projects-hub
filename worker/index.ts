import { Hono } from "hono";
import { runScheduledJobs } from "./jobs/dispatch";

export type AppEnv = { Bindings: Env };

export const app = new Hono<AppEnv>().basePath("/api");

// Health check: confirms the Worker is up and can reach D1.
app.get("/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({ status: "ok", database: row?.ok === 1 ? "ok" : "unavailable" });
});

// Unknown API routes return JSON, never the SPA shell.
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Never expose stack traces or internal messages to users (NFR-18, 11.13).
app.onError((err, c) => {
  const requestId = crypto.randomUUID();
  console.error(JSON.stringify({ level: "error", requestId, message: err.message, stack: err.stack }));
  return c.json({ error: "Something went wrong.", requestId }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledJobs(new Date(controller.scheduledTime), env));
  },
} satisfies ExportedHandler<Env>;
