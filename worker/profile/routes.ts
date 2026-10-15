import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { ACCESS_ERRORS } from "../../shared/access";
import { updatePreferencesBody } from "../../shared/projects";
import { requireSession } from "../auth/middleware";
import { getDb } from "../db/client";
import { users } from "../db/schema";
import type { AppEnv } from "../types";

// The signed-in person's own settings. Theme (Light, Dark, System) lives on the profile from Stage 2;
// the browser's saved choice stays as the fallback for signed-out pages and first paint (section 9).

export function profileRoutes() {
  const routes = new Hono<AppEnv>();

  routes.patch("/me/preferences", requireSession, async (c) => {
    const parsed = updatePreferencesBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: ACCESS_ERRORS.invalid, issues: parsed.error.issues }, 400);
    const { user } = c.get("auth");
    await getDb(c.env)
      .update(users)
      .set({ theme: parsed.data.theme, updatedAt: Date.now() })
      .where(eq(users.id, user.id));
    return c.json(parsed.data);
  });

  return routes;
}
