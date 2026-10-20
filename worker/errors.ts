import { type Context, Hono } from "hono";
import { z } from "zod";
import { ipHash } from "./auth/ip";
import type { AppEnv } from "./types";

// Errors (NFR-15, NFR-18, section 11.13). Users never see stack traces, codes or paths; logs carry a request id
// and no personal data. Every server error and crashed section adds a row to app_errors for the spike alert.

/** The `error` sent with 503 when the database can't be reached (NFR-18); the app shows the maintenance page. */
export const UNAVAILABLE = "unavailable";

/**
 * D1 itself is unreachable or overloaded, as opposed to a bug in a query (constraint, syntax, type), which
 * stays a 500. D1 reports both as D1_ERROR; SQLite's own error names mark the second kind.
 */
export function isDatabaseUnavailable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (!/\bD1(_[A-Z]+)?\b|D1 DB/.test(message)) return false;
  return !/SQLITE_(CONSTRAINT|ERROR|MISMATCH|RANGE|TOOBIG)|no such (table|column)/i.test(message);
}

async function recordError(env: Env, source: "server" | "client", requestId: string, section: string | null, ip: string | null) {
  try {
    // At most 20 rows per IP per hour, so a crash loop can't eat the D1 write budget (section 5).
    await env.DB.prepare(
      `INSERT INTO app_errors (source, section, request_id, ip_hash, at)
       SELECT ?1, ?2, ?3, ?4, ?5
       WHERE (SELECT count(*) FROM app_errors WHERE ip_hash IS ?4 AND at > ?5 - 3600000) < 20`,
    )
      .bind(source, section, requestId, ip, Date.now())
      .run();
  } catch {
    // The database may be what failed; the log line still exists.
  }
}

export async function handleError(err: Error, c: Context<AppEnv>) {
  const requestId = crypto.randomUUID();
  const unavailable = isDatabaseUnavailable(err);
  console.error(JSON.stringify({ level: "error", requestId, path: new URL(c.req.url).pathname, message: err.message, stack: err.stack, unavailable }));
  if (!unavailable) {
    const ip = await ipHash(c).catch(() => null);
    const pending = recordError(c.env, "server", requestId, null, ip);
    try {
      c.executionCtx.waitUntil(pending);
    } catch {
      // No execution context (tests): it runs anyway.
    }
  }
  return unavailable ? c.json({ error: UNAVAILABLE, requestId }, 503) : c.json({ error: "Something went wrong.", requestId }, 500);
}

const clientErrorBody = z.object({
  section: z.string().trim().max(40),
  message: z.string().max(300).default(""),
  path: z.string().max(200).default(""),
});

/** POST /api/client-errors: a React error boundary caught a crash (section 11.13). Works signed out too. */
export function clientErrorRoutes() {
  const routes = new Hono<AppEnv>();
  routes.post("/client-errors", async (c) => {
    const parsed = clientErrorBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid" }, 400);
    const requestId = crypto.randomUUID();
    const { section, message, path } = parsed.data;
    // Query strings can carry search words; keep the path only.
    console.error(JSON.stringify({ level: "error", source: "client", requestId, section, path: path.split("?")[0], message }));
    await recordError(c.env, "client", requestId, section, await ipHash(c));
    return c.json({ requestId }, 202);
  });
  return routes;
}
