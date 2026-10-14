import { type Context, Hono } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { AUTH_COPY, AUTH_ERRORS, type MeResponse, type SignInOutcome } from "../../shared/auth";
import { AUDIT } from "../audit";
import { getDb } from "../db/client";
import { hmac, randomToken, sha256Base64url } from "../lib/crypto";
import type { AppEnv } from "../types";
import { authorizeUrl, type GoogleClient, verifyIdToken } from "./google";
import { requireSession } from "./middleware";
import { clearSessionCookie, createSession, csrfTokenFor, endSession, setSessionCookie } from "./session";

// Short-lived cookie holding state, PKCE verifier and nonce between /start and /callback (section 7 step 1).
const OAUTH_COOKIE = "cph_oauth";
const OAUTH_COOKIE_MAX_AGE_S = 10 * 60;
const OAUTH_COOKIE_OPTIONS = {
  prefix: "host",
  path: "/",
  secure: true,
  httpOnly: true,
  // Lax lets the cookie come back on Google's top-level GET redirect to /callback.
  sameSite: "Lax",
} as const;

/** Keyed HMAC of the client IP: lets us rate-limit and audit without storing IPs (NFR-5). */
export function ipHash(c: Context<AppEnv>): Promise<string> {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  return hmac(c.env.SESSION_SECRET, `ip:${ip}`);
}

/** RATE-1 / NFR-4: 30 sign-in attempts per minute per IP, via the Workers rate-limiting binding. */
async function signInAllowed(c: Context<AppEnv>, ipKey: string): Promise<boolean> {
  const { success } = await c.env.SIGNIN_RATE_LIMITER.limit({ key: ipKey });
  return success;
}

/**
 * "Sign-in rate limit hit" audit event (section 6), at most once per IP per minute so a flood of
 * blocked attempts can't flood the log or the D1 write budget. One atomic statement: it inserts only
 * if this IP has no such event since the start of the current minute (uses audit_log (action, at)).
 */
async function auditRateLimitHit(c: Context<AppEnv>, ipKey: string, now: number): Promise<void> {
  const minuteStart = now - (now % 60_000);
  await c.env.DB.prepare(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
     SELECT NULL, ?1, 'ip', ?2, '{}', ?2, ?3
     WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action = ?1 AND at >= ?4 AND target_id = ?2)`,
  )
    .bind(AUDIT.signInRateLimited, ipKey, now, minuteStart)
    .run();
}

function home(c: Context<AppEnv>, outcome: SignInOutcome) {
  return c.redirect(`/?signin=${outcome}`, 302);
}

export function authRoutes(google: GoogleClient) {
  const routes = new Hono<AppEnv>();

  // Step 1: the home page button calls this, then navigates to the returned Google URL.
  routes.post("/start", async (c) => {
    const ipKey = await ipHash(c);
    if (!(await signInAllowed(c, ipKey))) {
      await auditRateLimitHit(c, ipKey, Date.now());
      return c.json({ error: AUTH_ERRORS.rateLimited, message: AUTH_COPY.rateLimited }, 429);
    }
    const state = randomToken(32);
    const nonce = randomToken(32);
    const codeVerifier = randomToken(32);
    await setSignedCookie(c, OAUTH_COOKIE, `${state}~${codeVerifier}~${nonce}`, c.env.SESSION_SECRET, {
      ...OAUTH_COOKIE_OPTIONS,
      maxAge: OAUTH_COOKIE_MAX_AGE_S,
    });
    const url = authorizeUrl({ env: c.env, state, nonce, codeChallenge: await sha256Base64url(codeVerifier) });
    return c.json({ url });
  });

  // Steps 2–4: Google redirects back here. Not counted against RATE-1 separately: one sign-in is one
  // attempt (counted at /start), and the callback does nothing without the cookie /start sets.
  routes.get("/callback", async (c) => {
    const ipKey = await ipHash(c);

    // Single use: the state cookie is cleared whatever happens next.
    const stored = await getSignedCookie(c, c.env.SESSION_SECRET, OAUTH_COOKIE, "host");
    deleteCookie(c, OAUTH_COOKIE, { prefix: "host", path: "/", secure: true });

    const code = c.req.query("code");
    const state = c.req.query("state");
    const [expectedState, codeVerifier, nonce] = typeof stored === "string" ? stored.split("~") : [];
    // Google sends ?error=access_denied when the person cancels; that also lands here.
    if (!code || !state || !expectedState || !codeVerifier || !nonce || state !== expectedState) {
      return home(c, "failed");
    }

    let identity;
    try {
      const idToken = await google.exchangeCode({ code, codeVerifier, env: c.env });
      identity = await verifyIdToken(idToken, { keys: google.keys, clientId: c.env.GOOGLE_CLIENT_ID, nonce });
    } catch (err) {
      // Log the reason for operators only; the person sees the generic copy.
      console.warn(JSON.stringify({ level: "warn", event: "signin_failed", message: (err as Error).message }));
      return home(c, "failed");
    }

    const now = Date.now();
    // Match on google_sub, never email (section 7 step 3). One atomic D1 batch:
    //  1. create the person as Pending if this google_sub is new (no-op otherwise);
    //  2. write the first-sign-in audit event only if step 1 inserted a row (changes() = 1);
    //  3. refresh email, name and photo from Google and return the row.
    const [, , refreshed] = await c.env.DB.batch<{ id: number; status: string; deleted_at: number | null }>([
      c.env.DB.prepare(
        `INSERT INTO users (google_sub, email, name, avatar_url, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5) ON CONFLICT (google_sub) DO NOTHING`,
      ).bind(identity.sub, identity.email, identity.name, identity.picture, now),
      c.env.DB.prepare(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
         SELECT id, ?1, 'user', CAST(id AS TEXT), '{}', ?2, ?3 FROM users WHERE google_sub = ?4 AND changes() = 1`,
      ).bind(AUDIT.firstSignIn, ipKey, now, identity.sub),
      c.env.DB.prepare(
        `UPDATE users SET email = ?1, name = ?2, avatar_url = ?3, updated_at = ?4 WHERE google_sub = ?5
         RETURNING id, status, deleted_at`,
      ).bind(identity.email, identity.name, identity.picture, now, identity.sub),
    ]);
    const user = refreshed?.results[0];
    if (!user || user.deleted_at !== null) return home(c, "failed");
    if (user.status === "suspended") return home(c, "suspended");

    const db = getDb(c.env);
    const sessionId = await createSession(db, {
      userId: user.id,
      ipHash: ipKey,
      userAgent: c.req.header("User-Agent") ?? null,
      now,
    });
    await setSessionCookie(c, sessionId);
    return c.redirect(user.status === "pending" ? "/request-access" : "/work", 302);
  });

  // Who am I, plus the CSRF token for writes. The client calls this on load.
  routes.get("/me", requireSession, async (c) => {
    const { user, sessionId } = c.get("auth");
    const body: MeResponse = {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        appRole: user.appRole,
        status: user.status,
        theme: user.theme,
      },
      csrfToken: await csrfTokenFor(c.env.SESSION_SECRET, sessionId),
    };
    c.header("Cache-Control", "no-store");
    return c.json(body);
  });

  routes.post("/logout", requireSession, async (c) => {
    await endSession(getDb(c.env), c.get("auth").sessionId, Date.now());
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  return routes;
}
