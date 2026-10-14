import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { AUTH_COPY } from "../shared/auth";
import { hmac } from "../worker/lib/crypto";
import { freshIp, startSignIn } from "./helpers/auth";

const LIMIT = 30;

/** The audit events for one IP, found by the same keyed hash the Worker stores. */
async function rateLimitEventsFor(ip: string) {
  const ipHash = await hmac(env.SESSION_SECRET, `ip:${ip}`);
  const { results } = await env.DB.prepare(
    "SELECT * FROM audit_log WHERE action = 'signin.rate_limited' AND target_id = ?",
  )
    .bind(ipHash)
    .all<Record<string, unknown>>();
  return { ipHash, results };
}

async function exhaust(ip: string, attempts = LIMIT) {
  for (let i = 0; i < attempts; i++) expect((await startSignIn(ip)).res.status).toBe(200);
}

// Each test fits inside one clock minute, so the limiter window and the once-per-minute audit rule
// can't roll over mid-test.
beforeEach(async () => {
  const intoMinute = Date.now() % 60_000;
  if (intoMinute > 50_000) await new Promise((r) => setTimeout(r, 60_000 - intoMinute + 100));
});

describe("RATE-1 Sign-in rate limit (NFR-4: 30 attempts per minute per IP)", () => {
  it("allows 30 sign-in attempts a minute, then returns 429 with the exact copy and no error code", async () => {
    const ip = freshIp();
    await exhaust(ip);
    const blocked = await startSignIn(ip);
    expect(blocked.res.status).toBe(429);
    expect(blocked.body).toEqual({ error: "rate_limited", message: AUTH_COPY.rateLimited });
    expect(AUTH_COPY.rateLimited).toBe("Too many sign-in attempts. Please wait a minute and try again.");
    // No state cookie or Google URL is handed out once limited.
    expect(blocked.oauthCookie).toBeUndefined();
    expect(blocked.url).toBeUndefined();
  });

  it("counts each IP separately", async () => {
    const busy = freshIp();
    await exhaust(busy);
    expect((await startSignIn(busy)).res.status).toBe(429);
    expect((await startSignIn(freshIp())).res.status).toBe(200);
  });

  it("writes a 'sign-in rate limit hit' audit event at most once per IP per minute", async () => {
    const ip = freshIp();
    await exhaust(ip);
    expect((await rateLimitEventsFor(ip)).results).toHaveLength(0);

    // Three blocked attempts in the same minute: one event.
    for (let i = 0; i < 3; i++) expect((await startSignIn(ip)).res.status).toBe(429);
    const { ipHash, results } = await rateLimitEventsFor(ip);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ actor_id: null, target_type: "ip", target_id: ipHash, ip_hash: ipHash });

    // A different IP hitting the limit gets its own event.
    const other = freshIp();
    await exhaust(other);
    await startSignIn(other);
    expect((await rateLimitEventsFor(other)).results).toHaveLength(1);
  });

  it("logs again in a later minute", async () => {
    const ip = freshIp();
    await exhaust(ip);
    await startSignIn(ip);
    const { ipHash, results } = await rateLimitEventsFor(ip);
    expect(results).toHaveLength(1);

    // Move this IP's event back into the previous minute; the next blocked attempt logs a new one.
    await env.DB.prepare("UPDATE audit_log SET at = at - 60000 WHERE action = 'signin.rate_limited' AND target_id = ?")
      .bind(ipHash)
      .run();
    expect((await startSignIn(ip)).res.status).toBe(429);
    expect((await rateLimitEventsFor(ip)).results).toHaveLength(2);
  });
});
