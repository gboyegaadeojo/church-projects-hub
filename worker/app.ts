import { Hono } from "hono";
import { inviteRoutes } from "./access/invites";
import { accessRequestRoutes } from "./access/requests";
import type { GoogleClient } from "./auth/google";
import { clientErrorRoutes, handleError } from "./errors";
import { notificationRoutes, unreadHeader } from "./notifications";
import { sameOriginWrites } from "./auth/middleware";
import { authRoutes } from "./auth/routes";
import { emailRoutes } from "./email/routes";
import { manageRoutes } from "./access/manage";
import { adminAuditRoutes } from "./admin/audit";
import { adminUsageRoutes } from "./admin/usage";
import { retentionRoutes } from "./admin/retention";
import { reportRoutes } from "./reports/routes";
import { adminUserRoutes } from "./admin/users";
import { feedbackRoutes } from "./feedback/routes";
import { profileRoutes } from "./profile/routes";
import { projectRoutes } from "./projects/routes";
import { attachmentRoutes } from "./tasks/attachments";
import { filterRoutes } from "./tasks/filters";
import { itemRoutes } from "./tasks/items";
import { orgRoutes } from "./tasks/org";
import { taskRoutes } from "./tasks/routes";
import { workRoutes } from "./tasks/work";
import type { AppEnv } from "./types";

export type AppDeps = { google: GoogleClient };

// The API. Built by a factory so tests can supply a Google client backed by a local test key;
// everything else (D1, sessions, rate limiter, permission checks) is the real thing.
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>().basePath("/api");

  app.use("*", sameOriginWrites);
  app.use("*", unreadHeader);

  // Health check: confirms the Worker is up and can reach D1.
  app.get("/health", async (c) => {
    const row = await c.env.DB.prepare("SELECT 1 AS ok")
      .first<{ ok: number }>()
      .catch(() => null);
    return row?.ok === 1 ? c.json({ status: "ok", database: "ok" }) : c.json({ status: "degraded", database: "unavailable" }, 503);
  });
  app.route("/", clientErrorRoutes());

  app.route("/auth", authRoutes(deps.google));
  // Each route in these carries its own guards (requireSession, requirePermission), so mounting
  // at the root never puts a session check on public routes like /health.
  app.route("/", accessRequestRoutes());
  app.route("/", inviteRoutes());
  app.route("/", projectRoutes());
  app.route("/", profileRoutes());
  app.route("/", taskRoutes());
  app.route("/", itemRoutes());
  app.route("/", orgRoutes());
  app.route("/", filterRoutes());
  app.route("/", attachmentRoutes());
  app.route("/", workRoutes());
  app.route("/", notificationRoutes());
  app.route("/", emailRoutes());
  app.route("/", feedbackRoutes());
  app.route("/", adminUserRoutes());
  app.route("/", manageRoutes());
  app.route("/", adminAuditRoutes());
  app.route("/", adminUsageRoutes());
  app.route("/", retentionRoutes());
  app.route("/", reportRoutes());

  // Unknown API routes return JSON, never the SPA shell.
  app.notFound((c) => c.json({ error: "Not found" }, 404));

  // Never expose stack traces or internal messages to users (NFR-18, 11.13); D1 outages answer 503.
  app.onError(handleError);

  return app;
}
