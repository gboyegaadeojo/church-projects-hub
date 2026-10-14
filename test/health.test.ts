import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Stage 0 — health check", () => {
  it("GET /api/health reports the Worker and D1 are up", async () => {
    const res = await exports.default.fetch("https://hub.test/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("unknown API routes return JSON 404, not the app shell", async () => {
    const res = await exports.default.fetch("https://hub.test/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});
