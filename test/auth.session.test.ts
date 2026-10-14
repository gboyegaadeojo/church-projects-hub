import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { LAST_SEEN_INTERVAL_MS, revokeSession, SESSION_TTL_MS } from "../worker/auth/session";
import { getDb } from "../worker/db/client";
import { request, signedInClient, signIn } from "./helpers/auth";

// Session revocation is tested against the real check in the Worker and real D1 rows (section 17).

function sessionIdFrom(cookie: string): string {
  // Cookie value is `<id>.<signature>`, URL-encoded.
  const value = decodeURIComponent(cookie.split("=").slice(1).join("="));
  return value.slice(0, value.lastIndexOf("."));
}

async function sessionRow(id: string) {
  return env.DB.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first<Record<string, number | string | null>>();
}

describe("NFR-2 Session cookie", () => {
  it("is HttpOnly, Secure, SameSite=Lax, host-only and lasts 30 days", async () => {
    const { session } = await signIn();
    const raw = session!.raw;
    expect(raw).toMatch(/^__Host-cph_session=/);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Secure/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\//);
    expect(raw).not.toMatch(/Domain=/i);
    expect(raw).toMatch(new RegExp(`Max-Age=${SESSION_TTL_MS / 1000}`));
  });

  it("holds a random 256-bit session id stored server-side", async () => {
    const { cookie, userId } = await signedInClient();
    const id = sessionIdFrom(cookie);
    expect(id).toMatch(/^[\w-]{43}$/);
    const row = await sessionRow(id);
    expect(row).toMatchObject({ user_id: userId, revoked_at: null });
    expect(row!.ip_hash).toMatch(/^[\w-]{43}$/);
  });

  it("rejects a cookie whose signature does not match", async () => {
    const { cookie } = await signedInClient();
    const res = await request("/api/auth/me", { cookie: `${cookie.slice(0, -4)}AAAA` });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "session_ended" });
  });
});

describe("NFR-1 Unauthenticated requests are rejected", () => {
  it("returns 401 without a session cookie", async () => {
    const res = await request("/api/auth/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });
});

describe("AUTH-6 Sessions last 30 days and are revocable", () => {
  it("sets the session to expire 30 days after sign-in", async () => {
    const before = Date.now();
    const { cookie } = await signedInClient();
    const row = await sessionRow(sessionIdFrom(cookie));
    expect(row!.expires_at as number).toBeGreaterThanOrEqual(before + SESSION_TTL_MS);
    expect(row!.expires_at as number).toBeLessThanOrEqual(Date.now() + SESSION_TTL_MS);
  });

  it("rejects an expired session", async () => {
    const { cookie } = await signedInClient();
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, sessionIdFrom(cookie)).run();
    const res = await request("/api/auth/me", { cookie });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "session_ended" });
  });

  it("ends a suspended user's access on the very next request", async () => {
    const { cookie, userId } = await signedInClient();
    expect((await request("/api/auth/me", { cookie })).status).toBe(200);
    await env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").bind(userId).run();
    const res = await request("/api/auth/me", { cookie });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "suspended" });
  });

  it("revokeSession sets revoked_at and writes a 'session revoked' audit event", async () => {
    const { cookie, userId } = await signedInClient();
    const admin = await signedInClient();
    const sessionId = sessionIdFrom(cookie);

    const revoked = await revokeSession(getDb(env), {
      sessionId,
      actorId: admin.userId,
      ipHash: "admin-ip-hash",
      reason: "admin",
      now: Date.now(),
    });
    expect(revoked).toBe(true);
    expect((await sessionRow(sessionId))!.revoked_at).not.toBeNull();

    const audit = await env.DB.prepare("SELECT * FROM audit_log WHERE action = 'session.revoked' AND target_id = ?")
      .bind(String(userId))
      .all<Record<string, unknown>>();
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0]).toMatchObject({ actor_id: admin.userId, target_type: "user", ip_hash: "admin-ip-hash" });
    const detail = JSON.parse(audit.results[0]!.detail_json as string);
    expect(detail).toEqual({ reason: "admin", session: sessionId.slice(0, 8) });

    // Revoking again changes nothing and logs nothing.
    expect(await revokeSession(getDb(env), { sessionId, actorId: admin.userId, ipHash: null, reason: "admin", now: Date.now() })).toBe(false);
  });
});

describe("AUTH-7 A session revoked mid-use ends on the next request", () => {
  it("returns 401 session_ended (no error code for the user to see) and clears the cookie", async () => {
    const { cookie } = await signedInClient();
    expect((await request("/api/auth/me", { cookie })).status).toBe(200);

    await revokeSession(getDb(env), { sessionId: sessionIdFrom(cookie), actorId: null, ipHash: null, reason: "test", now: Date.now() });

    const res = await request("/api/auth/me", { cookie });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "session_ended" });
    expect(res.headers.getSetCookie().find((c) => c.startsWith("__Host-cph_session="))).toMatch(/Max-Age=0/i);
  });
});

describe("NFR-2 CSRF protection on every write", () => {
  it("rejects a write without the CSRF token", async () => {
    const { cookie } = await signedInClient();
    const res = await request("/api/auth/logout", { method: "POST", cookie });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "csrf_failed" });
  });

  it("rejects a write with another session's CSRF token", async () => {
    const a = await signedInClient();
    const b = await signedInClient();
    const res = await request("/api/auth/logout", { method: "POST", cookie: a.cookie, headers: { "X-CSRF-Token": b.csrfToken } });
    expect(res.status).toBe(403);
  });

  it("rejects a write from another origin even with a valid token", async () => {
    const { cookie, csrfToken } = await signedInClient();
    const res = await request("/api/auth/logout", {
      method: "POST",
      cookie,
      headers: { "X-CSRF-Token": csrfToken, Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects a write with no Origin unless the browser marks it same-origin", async () => {
    const res = await request("/api/auth/start", { method: "POST", headers: { Origin: "" } });
    expect(res.status).toBe(403);
  });
});

describe("Sign-out", () => {
  it("revokes the session server-side and clears the cookie", async () => {
    const { cookie, csrfToken } = await signedInClient();
    const res = await request("/api/auth/logout", { method: "POST", cookie, headers: { "X-CSRF-Token": csrfToken } });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().find((c) => c.startsWith("__Host-cph_session="))).toMatch(/Max-Age=0/i);
    expect((await sessionRow(sessionIdFrom(cookie)))!.revoked_at).not.toBeNull();
    // The old cookie no longer works, even if a copy was kept.
    expect((await request("/api/auth/me", { cookie })).status).toBe(401);
  });
});

describe("NFR-23 last_seen_at is written at most every 15 minutes", () => {
  async function lastSeen(userId: number) {
    return (await env.DB.prepare("SELECT last_seen_at FROM users WHERE id = ?").bind(userId).first<{ last_seen_at: number | null }>())!
      .last_seen_at;
  }

  it("writes it on the first request, then not again within 15 minutes", async () => {
    const { cookie, userId } = await signedInClient();
    const first = await lastSeen(userId);
    expect(first).not.toBeNull();

    const recent = Date.now() - 5 * 60 * 1000;
    await env.DB.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(recent, userId).run();
    await request("/api/auth/me", { cookie });
    await request("/api/auth/me", { cookie });
    expect(await lastSeen(userId)).toBe(recent);
  });

  it("writes it again once 15 minutes have passed", async () => {
    const { cookie, userId } = await signedInClient();
    const stale = Date.now() - LAST_SEEN_INTERVAL_MS - 1000;
    await env.DB.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(stale, userId).run();
    const before = Date.now();
    await request("/api/auth/me", { cookie });
    expect(await lastSeen(userId)).toBeGreaterThanOrEqual(before);
  });
});
