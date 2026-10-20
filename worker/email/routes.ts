import { Hono } from "hono";
import { ACCESS_ERRORS } from "../../shared/access";
import {
  type EmailMode,
  NOTIFICATION_EVENTS,
  type NotificationSettings,
  type NotificationType,
  SETTABLE_EVENTS,
  unsubscribeBody,
  updateNotificationSettingsBody,
} from "../../shared/notifications";
import { requireSession } from "../auth/middleware";
import { timingSafeEqual } from "../lib/crypto";
import { isTimeZone } from "../lib/time";
import type { AppEnv } from "../types";
import { unsubscribeToken } from "./sender";

// Email settings (NOTIF-5: each event instant, in the 7 am digest, or off; the digest's timezone) and
// one-click unsubscribe (NOTIF-6), which needs no sign-in: the signed link is the proof.

async function modesFor(env: Pick<Env, "DB">, userId: number): Promise<Map<NotificationType, EmailMode>> {
  const { results } = await env.DB.prepare("SELECT event_type, mode FROM notification_prefs WHERE user_id = ? AND channel = 'email'")
    .bind(userId)
    .all<{ event_type: NotificationType; mode: EmailMode }>();
  const own = new Map(results.map((r) => [r.event_type, r.mode]));
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

  // RFC 8058: mail apps POST here straight from the List-Unsubscribe header; the /unsubscribe page posts here
  // after the person presses the button. Either way the link's own query string says who and what.
  routes.post("/unsubscribe", async (c) => {
    const parsed = unsubscribeBody.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: ACCESS_ERRORS.invalid }, 400);
    const { u, e, t } = parsed.data;
    if (!timingSafeEqual(t, await unsubscribeToken(c.env.SESSION_SECRET, u, e))) return c.json({ error: ACCESS_ERRORS.invalid }, 400);
    const exists = await c.env.DB.prepare("SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL").bind(u).first();
    if (!exists) return c.json({ error: ACCESS_ERRORS.invalid }, 400);

    // "digest" turns off everything that would arrive in the morning digest.
    const modes = await modesFor(c.env, u);
    const off: [string, EmailMode][] =
      e === "digest" ? [...modes].filter(([, m]) => m === "digest").map(([type]) => [type, "off"]) : [[e, "off"]];
    if (off.length > 0) await c.env.DB.batch(upserts(c.env, u, off, Date.now()));
    return c.json({ ok: true, event: e });
  });

  return routes;
}
