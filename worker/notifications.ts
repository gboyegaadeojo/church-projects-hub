import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
  BELL_LIMIT,
  type NotificationItem,
  notificationPayload,
  type NotificationsResponse,
  type NotificationType,
  UNREAD_CAP,
  UNREAD_HEADER,
} from "../shared/notifications";
import { forbidden, idParam } from "./auth/authorize";
import { requireSession } from "./auth/middleware";
import type { AppEnv } from "./types";

// The notification bell (NOTIF-4, section 11.8).

/** Unread count, capped so a long backlog costs at most UNREAD_CAP rows read (uses (user_id, read_at)). */
export async function unreadCount(env: Pick<Env, "DB">, userId: number): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT count(*) AS n FROM (SELECT 1 FROM notifications WHERE user_id = ?1 AND read_at IS NULL LIMIT ?2)",
  )
    .bind(userId, UNREAD_CAP)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Section 11.8: every signed-in API response carries the unread count, so the bell stays current without polling.
 * Runs after the route, only when the route signed someone in.
 */
export const unreadHeader = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  const auth = c.get("auth");
  if (!auth || c.res.status >= 500 || auth.user.status !== "active") return;
  try {
    c.res.headers.set(UNREAD_HEADER, String(await unreadCount(c.env, auth.user.id)));
  } catch {
    // Immutable headers (a streamed file) or a database hiccup: the bell catches up on its next refresh.
  }
});

type Row = {
  id: number;
  type: NotificationType;
  payload_json: string;
  read_at: number | null;
  created_at: number;
  actor_id: number | null;
  actor_name: string | null;
  actor_avatar: string | null;
};

function toItem(r: Row): NotificationItem {
  const payload = notificationPayload.safeParse(JSON.parse(r.payload_json));
  return {
    id: r.id,
    type: r.type,
    actor: r.actor_id !== null && r.actor_name !== null ? { id: r.actor_id, name: r.actor_name, avatarUrl: r.actor_avatar } : null,
    payload: payload.success ? payload.data : {},
    read: r.read_at !== null,
    createdAt: r.created_at,
  };
}

export function notificationRoutes() {
  const routes = new Hono<AppEnv>();

  // ?since= limits to newer than a time (the dropdown's 30 days); ?before= pages back through older ones.
  routes.get("/notifications", requireSession, async (c) => {
    const { user } = c.get("auth");
    if (user.status !== "active") return forbidden(c, 403);
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? BELL_LIMIT) || BELL_LIMIT, 1), 50);
    const before = Number(c.req.query("before") ?? "") || Number.MAX_SAFE_INTEGER;
    const since = Number(c.req.query("since") ?? "") || 0;
    const { results } = await c.env.DB.prepare(
      `SELECT n.id, n.type, n.payload_json, n.read_at, n.created_at, n.actor_id, a.name AS actor_name, a.avatar_url AS actor_avatar
       FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
       WHERE n.user_id = ?1 AND n.id < ?2 AND n.created_at >= ?3
       ORDER BY n.id DESC LIMIT ?4`,
    )
      .bind(user.id, before, since, limit + 1)
      .all<Row>();
    const page = results.slice(0, limit);
    const body: NotificationsResponse = {
      items: page.map(toItem),
      unread: await unreadCount(c.env, user.id),
      nextBefore: results.length > limit ? page.at(-1)!.id : null,
    };
    c.header("Cache-Control", "no-store");
    return c.json(body);
  });

  routes.post("/notifications/:id/read", requireSession, async (c) => {
    const id = idParam(c, "id");
    if (id === null) return forbidden(c, 404);
    const { user } = c.get("auth");
    await c.env.DB.prepare("UPDATE notifications SET read_at = ?3 WHERE id = ?1 AND user_id = ?2 AND read_at IS NULL")
      .bind(id, user.id, Date.now())
      .run();
    return c.json({ ok: true });
  });

  routes.post("/notifications/read-all", requireSession, async (c) => {
    const { user } = c.get("auth");
    await c.env.DB.prepare("UPDATE notifications SET read_at = ?2 WHERE user_id = ?1 AND read_at IS NULL").bind(user.id, Date.now()).run();
    return c.json({ ok: true });
  });

  return routes;
}
