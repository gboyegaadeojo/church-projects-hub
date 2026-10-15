import type { Context } from "hono";
import { hmac } from "../lib/crypto";
import type { AppEnv } from "../types";

/** Keyed HMAC of the client IP: lets us rate-limit and audit without storing IPs (NFR-5). */
export function ipHash(c: Context<AppEnv>): Promise<string> {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  return hmac(c.env.SESSION_SECRET, `ip:${ip}`);
}
