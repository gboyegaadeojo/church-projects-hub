import { Hono } from "hono";
import { inviteRoutes } from "./access/invites";
import { accessRequestRoutes } from "./access/requests";
import type { GoogleClient } from "./auth/google";
import { sameOriginWrites } from "./auth/middleware";
import { authRoutes } from "./auth/routes";
import { profileRoutes } from "./profile/routes";
import { projectRoutes } from "./projects/routes";
import type { AppEnv } from "./types";

export type AppDeps = { google: GoogleClient };

// The API. Built by a factory so tests can supply a Google client backed by a local test key;
// everything else (D1, sessions, rate limiter, permission checks) is the real thing.
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>().basePath("/api");

  app.use("*", sameOriginWrites);

  // Health check: confirms the Worker is up and can reach D1.
  app.get("/health", async (c) => {
    const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return c.json({ status: "ok", database: row?.ok === 1 ? "ok" : "unavailable" });
  });

  app.route("/auth", authRoutes(deps.google));
  // Each route in these carries its own guards (requireSession, requirePermission), so mounting
  // at the root never puts a session check on public routes like /health.
  app.route("/", accessRequestRoutes());
  app.route("/", inviteRoutes());
  app.route("/", projectRoutes());
  app.route("/", profileRoutes());

  // Unknown API routes return JSON, never the SPA shell.
  app.notFound((c) => c.json({ error: "Not found" }, 404));

  // Never expose stack traces or internal messages to users (NFR-18, 11.13).
  app.onError((err, c) => {
    const requestId = crypto.randomUUID();
    console.error(JSON.stringify({ level: "error", requestId, message: err.message, stack: err.stack }));
    return c.json({ error: "Something went wrong.", requestId }, 500);
  });

  return app;
}
