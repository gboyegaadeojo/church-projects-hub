import { and, eq, isNull, lte, or } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { AUDIT, auditInsert } from "../audit";
import type { Db } from "../db/client";
import { sessions, type User, users } from "../db/schema";
import { hmac, randomToken } from "../lib/crypto";

// Server-side sessions (section 7 step 4, AUTH-6, NFR-2, NFR-23).

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const LAST_SEEN_INTERVAL_MS = 15 * 60 * 1000;

// Sent as `__Host-cph_session`: Secure, Path=/, no Domain, so no other origin or path can set or read it.
const SESSION_COOKIE = "cph_session";

export async function createSession(
  db: Db,
  params: { userId: number; ipHash: string | null; userAgent: string | null; now: number },
): Promise<string> {
  const id = randomToken(32);
  await db.insert(sessions).values({
    id,
    userId: params.userId,
    expiresAt: params.now + SESSION_TTL_MS,
    ipHash: params.ipHash,
    // Trimmed: only used to help an admin recognise a device.
    userAgent: params.userAgent?.slice(0, 256) ?? null,
    createdAt: params.now,
    updatedAt: params.now,
    createdBy: params.userId,
  });
  return id;
}

export async function setSessionCookie(c: Context, sessionId: string): Promise<void> {
  await setSignedCookie(c, SESSION_COOKIE, sessionId, c.env.SESSION_SECRET, {
    prefix: "host",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { prefix: "host", path: "/", secure: true });
}

/**
 * The session id from the signed cookie: `undefined` when there is no cookie,
 * `false` when it is present but the signature doesn't match.
 */
export async function readSessionCookie(c: Context): Promise<string | undefined | false> {
  const id = await getSignedCookie(c, c.env.SESSION_SECRET, SESSION_COOKIE, "host");
  // Hono reports a malformed signature as "no cookie"; any cookie that fails the check is invalid.
  if (id === undefined && getCookie(c, SESSION_COOKIE, "host") !== undefined) return false;
  return id;
}

export type SessionCheck =
  | { ok: true; user: User; sessionId: string }
  | { ok: false; reason: "ended" | "suspended" };

/**
 * One query per request: the session joined to its user. Revocation, expiry and suspension are
 * checked here on every authenticated call, so they take effect within one request cycle (AUTH-6, AUTH-7).
 */
export async function checkSession(db: Db, sessionId: string, now: number): Promise<SessionCheck> {
  const row = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .get();
  if (!row) return { ok: false, reason: "ended" };
  if (row.session.revokedAt !== null || row.session.expiresAt <= now || row.user.deletedAt !== null) {
    return { ok: false, reason: "ended" };
  }
  if (row.user.status === "suspended") return { ok: false, reason: "suspended" };
  return { ok: true, user: row.user, sessionId };
}

/**
 * Write discipline (NFR-23): `last_seen_at` is written only when the stored value is at least
 * 15 minutes old. The decision uses the row already loaded, so most requests write nothing.
 */
export async function touchLastSeen(db: Db, user: User, now: number): Promise<void> {
  if (user.lastSeenAt !== null && now - user.lastSeenAt < LAST_SEEN_INTERVAL_MS) return;
  await db
    .update(users)
    .set({ lastSeenAt: now })
    .where(
      and(eq(users.id, user.id), or(isNull(users.lastSeenAt), lte(users.lastSeenAt, now - LAST_SEEN_INTERVAL_MS))),
    );
}

/** Sign-out: the person ends their own session. Not audited (Stage 2a decision). */
export async function endSession(db: Db, sessionId: string, now: number): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/**
 * Revoke a session on someone's behalf (admin revoke, suspension) and write the audit event in the
 * same batch. Returns false if the session didn't exist or was already revoked (nothing is logged).
 */
export async function revokeSession(
  db: Db,
  params: { sessionId: string; actorId: number | null; ipHash: string | null; reason: string; now: number },
): Promise<boolean> {
  const target = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.id, params.sessionId), isNull(sessions.revokedAt)))
    .get();
  if (!target) return false;
  await db.batch([
    db
      .update(sessions)
      .set({ revokedAt: params.now, updatedAt: params.now })
      .where(and(eq(sessions.id, params.sessionId), isNull(sessions.revokedAt))),
    auditInsert(db, {
      actorId: params.actorId,
      action: AUDIT.sessionRevoked,
      targetType: "user",
      targetId: target.userId,
      // The session id itself is a credential until it expires; only a fingerprint goes in the log.
      detail: { reason: params.reason, session: params.sessionId.slice(0, 8) },
      ipHash: params.ipHash,
    }),
  ]);
  return true;
}

/** CSRF token bound to the session (NFR-2). Stateless: derived, never stored. */
export function csrfTokenFor(secret: string, sessionId: string): Promise<string> {
  return hmac(secret, `csrf:${sessionId}`);
}
