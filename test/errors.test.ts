import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { MeResponse } from "../shared/auth";
import { isDatabaseUnavailable } from "../worker/errors";
import { call, request, signedInClient } from "./helpers/auth";

// NFR-15 / NFR-18 / section 11.13 error handling, and the sign-in count for NFR-21.

describe("NFR-18 telling a D1 outage from a bug", () => {
  it("treats D1 network, overload and internal errors as unavailable", () => {
    for (const message of [
      "D1_ERROR: Network connection lost.",
      "D1 DB is overloaded. Requests queued for too long.",
      "D1_ERROR: internal error; reference = abc123",
      "D1_ERROR: Storage operation exceeded timeout which caused object to be reset.",
    ]) {
      expect(isDatabaseUnavailable(new Error(message)), message).toBe(true);
    }
  });

  it("keeps query bugs as ordinary errors", () => {
    for (const message of [
      "D1_ERROR: UNIQUE constraint failed: labels.name: SQLITE_CONSTRAINT",
      "D1_ERROR: near \"SELEC\": syntax error: SQLITE_ERROR",
      "D1_ERROR: no such table: nope",
      "TypeError: cannot read properties of undefined",
    ]) {
      expect(isDatabaseUnavailable(new Error(message)), message).toBe(false);
    }
  });
});

describe("Section 11.13 client error reports", () => {
  it("records a crashed section without personal data and caps rows per IP", async () => {
    const ip = "198.51.100.77";
    const res = await request("/api/client-errors", {
      method: "POST",
      ip,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: "board", message: "TypeError: x is undefined", path: "/projects/MEDIA?task=MEDIA-4" }),
    });
    expect(res.status).toBe(202);
    const { requestId } = (await res.json()) as { requestId: string };
    const row = await env.DB.prepare("SELECT * FROM app_errors WHERE request_id = ?").bind(requestId).first<Record<string, unknown>>();
    expect(row).toMatchObject({ source: "client", section: "board" });
    expect(Object.keys(row!)).not.toContain("message");

    for (let i = 0; i < 25; i++) {
      await request("/api/client-errors", { method: "POST", ip, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section: "loop" }) });
    }
    const count = await env.DB.prepare("SELECT count(*) AS n FROM app_errors WHERE ip_hash = (SELECT ip_hash FROM app_errors WHERE request_id = ?)")
      .bind(requestId)
      .first<{ n: number }>();
    expect(count!.n).toBe(20);
  });

  it("rejects malformed reports and cross-site posts", async () => {
    expect((await request("/api/client-errors", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(400);
    const crossSite = await request("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ section: "x" }),
    });
    expect(crossSite.status).toBe(403);
  });
});

describe("NFR-21 sign-in count", () => {
  it("counts each sign-in", async () => {
    const client = await signedInClient({ sub: `count-${crypto.randomUUID()}` });
    let me = (await (await call(client, "GET", "/api/auth/me")).json()) as MeResponse;
    expect(me.signInCount).toBe(1);
    const again = await signedInClient({ sub: client.sub });
    me = (await (await call(again, "GET", "/api/auth/me")).json()) as MeResponse;
    expect(me.signInCount).toBe(2);
  });
});
