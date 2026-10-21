import { Hono } from "hono";
import { ACCESS_ERRORS } from "../../shared/access";
import {
  EMAIL_REQUIRED,
  type EmailMode,
  NOTIFICATION_EVENTS,
  type NotificationSettings,
  type NotificationType,
  SETTABLE_EVENTS,
  updateNotificationSettingsBody,
} from "../../shared/notifications";
import { requireSession } from "../auth/middleware";
import { isTimeZone } from "../lib/time";
import type { AppEnv } from "../types";

// Email settings (NOTIF-5): each email right away or in the 7 am digest, and the digest's timezone. Since v4.7 email
// is required for everyone: there is no "off", and the old one-click unsubscribe links (NOTIF-6) no longer turn
// anything off.

async function modesFor(env: Pick<Env, "DB">, userId: number): Promise<Map<NotificationType, EmailMode>> {
  const { results } = await env.DB.prepare("SELECT event_type, mode FROM notification_prefs WHERE user_id = ? AND channel = 'email'")
    .bind(userId)
    .all<{ event_type: NotificationType; mode: EmailMode }>();
  // A stored "off" from before v4.7 counts as the event's default.
  const own = new Map(results.filter((r) => r.mode !== "off").map((r) => [r.event_type, r.mode]));
  return new Map(SETTABLE_EVENTS.map((t) => [t, own.get(t) ?? NOTIFICATION_EVENTS[t].email]));
}

function upserts(env: Pick<Env, "DB">, userId: number, modes: [string, EmailMode][], now: number) {
  return modes.map(([type, mode]) =>
    env.DB.prepare(
      `INSERT INTO notification_prefs (user_id, event_type, channel, mode, created_at, updated_at, created_by)
       VALUES (?1, ?2, 'email', ?3, ?4, ?4, ?1)
       ON CONFLICT (user_id, event_type, channel) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`,
    ).bind(userId, type, mode, now),
  );
}

export function emailRoutes() {
  const routes = new Hono<AppEnv>();

  routes.get("/me/notification-settings", requireSession, async (c) => {
    const { user } = c.get("auth");
    const modes = await modesFor(c.env, user.id);
    const body: NotificationSettings = {
      timezone: user.timezone,
      events: SETTABLE_EVENTS.map((type) => ({ type, mode: modes.get(type)!, defaultMode: NOTIFICATION_EVENTS[type].email })),
    };
    return c.json(body);
  });

  routes.put("/me/notification-settings", requireSession, async (c) => {
    const parsed = updateNotificationSettingsBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || (parsed.data.timezone !== undefined && !isTimeZone(parsed.data.timezone))) {
      return c.json({ error: ACCESS_ERRORS.invalid }, 400);
    }
    const { user } = c.get("auth");
    const now = Date.now();
    const events = Object.entries(parsed.data.events ?? {}).filter(([t]) => (SETTABLE_EVENTS as string[]).includes(t)) as [string, EmailMode][];
    await c.env.DB.batch([
      ...(parsed.data.timezone ? [c.env.DB.prepare("UPDATE users SET timezone = ?2, updated_at = ?3 WHERE id = ?1").bind(user.id, parsed.data.timezone, now)] : []),
      ...upserts(c.env, user.id, events, now),
    ]);
    return c.json({ ok: true });
  });

  // v4.7: links in emails sent before email became required still arrive here (mail apps POST from the old
  // List-Unsubscribe header). Nothing is turned off; the /unsubscribe page explains and links to Email settings.
  routes.post("/unsubscribe", (c) => c.json({ error: EMAIL_REQUIRED }, 410));

  return routes;
}
