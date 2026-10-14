import { createMiddleware } from "hono/factory";
import { AUTH_ERRORS, CSRF_HEADER } from "../../shared/auth";
import { getDb } from "../db/client";
import { timingSafeEqual } from "../lib/crypto";
import type { AppEnv } from "../types";
import { checkSession, clearSessionCookie, csrfTokenFor, readSessionCookie, touchLastSeen } from "./session";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Same-origin check on every write (NFR-2), signed in or not. Browsers always send Origin on
 * cross-site POST/PUT/PATCH/DELETE; a missing Origin is accepted only when Sec-Fetch-Site says same-origin.
 */
export const sameOriginWrites = createMiddleware<AppEnv>(async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  const origin = c.req.header("Origin");
  const ok = origin
    ? origin === new URL(c.req.url).origin
    : c.req.header("Sec-Fetch-Site") === "same-origin";
  if (!ok) return c.json({ error: AUTH_ERRORS.csrf }, 403);
  return next();
});

/**
 * Authenticated routes. Checks the session on every request (NFR-1, AUTH-6, AUTH-7) and, for writes,
 * the CSRF token. Pending users pass; project permissions are checked per route from Stage 2b.
 */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const sessionId = await readSessionCookie(c);
  if (sessionId === undefined) return c.json({ error: AUTH_ERRORS.unauthenticated }, 401);

  const now = Date.now();
  const db = getDb(c.env);
  const result = sessionId === false ? ({ ok: false, reason: "ended" } as const) : await checkSession(db, sessionId, now);
  if (!result.ok) {
    clearSessionCookie(c);
    return result.reason === "suspended"
      ? c.json({ error: AUTH_ERRORS.suspended }, 403)
      : c.json({ error: AUTH_ERRORS.sessionEnded }, 401);
  }

  if (!SAFE_METHODS.has(c.req.method)) {
    const sent = c.req.header(CSRF_HEADER) ?? "";
    const expected = await csrfTokenFor(c.env.SESSION_SECRET, result.sessionId);
    if (!timingSafeEqual(sent, expected)) return c.json({ error: AUTH_ERRORS.csrf }, 403);
  }

  await touchLastSeen(db, result.user, now);
  c.set("auth", { user: result.user, sessionId: result.sessionId });
  return next();
});
