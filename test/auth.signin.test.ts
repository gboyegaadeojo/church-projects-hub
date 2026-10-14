import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { exchangedCodes, freshIp, freshSub, request, signedInClient, signIdToken, signIn, startSignIn } from "./helpers/auth";

async function userBySub(sub: string) {
  return env.DB.prepare("SELECT * FROM users WHERE google_sub = ?").bind(sub).first<Record<string, unknown>>();
}

async function auditRows(action: string, targetId: number) {
  const { results } = await env.DB.prepare("SELECT * FROM audit_log WHERE action = ? AND target_id = ?")
    .bind(action, String(targetId))
    .all<Record<string, unknown>>();
  return results;
}

async function sha256Base64url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("AUTH-1 Sign in with Google only, with PKCE and state (NFR-2)", () => {
  it("start returns a Google URL with state, nonce, an S256 PKCE challenge and basic scopes only", async () => {
    const { res, url, oauthCookie } = await startSignIn(freshIp());
    expect(res.status).toBe(200);
    expect(url?.origin + url!.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = url!.searchParams;
    expect(p.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(env.GOOGLE_REDIRECT_URI);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe("openid email profile");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("state")).toMatch(/^[\w-]{43}$/);
    expect(p.get("nonce")).toMatch(/^[\w-]{43}$/);
    expect(p.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    // The verifier lives only in a short-lived, signed, HttpOnly cookie.
    expect(oauthCookie?.raw).toMatch(/HttpOnly/i);
    expect(oauthCookie?.raw).toMatch(/Secure/i);
    expect(oauthCookie?.raw).toMatch(/SameSite=Lax/i);
    expect(oauthCookie?.raw).toMatch(/Max-Age=600/i);
  });

  it("sends the PKCE verifier that matches the challenge when exchanging the code", async () => {
    const { start } = await signIn();
    const sent = exchangedCodes.at(-1)!;
    expect(sent.code).toBe("test-code");
    expect(await sha256Base64url(sent.codeVerifier)).toBe(start.url!.searchParams.get("code_challenge"));
  });

  it("rejects a callback whose state does not match", async () => {
    const { res, sessionCookie } = await signIn({ state: "forged-state" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/?signin=failed");
    expect(sessionCookie).toBeUndefined();
  });

  it("rejects a callback without the state cookie", async () => {
    const res = await request("/api/auth/callback?code=test-code&state=anything", { ip: freshIp() });
    expect(res.headers.get("Location")).toBe("/?signin=failed");
  });

  it("rejects a state cookie that was tampered with", async () => {
    const ip = freshIp();
    const start = await startSignIn(ip);
    const state = start.url!.searchParams.get("state")!;
    const res = await request(`/api/auth/callback?code=test-code&state=${state}`, {
      ip,
      cookie: `__Host-cph_oauth=${encodeURIComponent(`${state}~attacker-verifier~nonce`)}.forgedsignature`,
    });
    expect(res.headers.get("Location")).toBe("/?signin=failed");
  });

  it("treats a cancelled Google consent (error=access_denied) as a failed sign-in", async () => {
    const ip = freshIp();
    const start = await startSignIn(ip);
    const res = await request(`/api/auth/callback?error=access_denied&state=${start.url!.searchParams.get("state")}`, {
      ip,
      cookie: `__Host-cph_oauth=${start.oauthCookie!.value}`,
    });
    expect(res.headers.get("Location")).toBe("/?signin=failed");
  });

  it("clears the state cookie so a callback cannot be replayed", async () => {
    const { res } = await signIn();
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith("__Host-cph_oauth="));
    expect(cleared).toMatch(/Max-Age=0/i);
  });
});

describe("AUTH-1 Google ID token verification (section 7 step 2, NFR-2)", () => {
  const sub = "verification-sub";
  const base = { sub, email: "v@example.org", name: "V" };
  const cases: [string, (nonce: string) => Promise<string>][] = [
    ["a signature from a key Google did not publish", (nonce) => signIdToken({ claims: { ...base, nonce }, wrongKey: true })],
    ["the wrong issuer", (nonce) => signIdToken({ claims: { ...base, nonce }, issuer: "https://evil.example" })],
    ["another app's audience", (nonce) => signIdToken({ claims: { ...base, nonce }, audience: "other-client" })],
    ["an expired token", (nonce) => signIdToken({ claims: { ...base, nonce }, expiresIn: -120 })],
    ["a nonce from another sign-in", () => signIdToken({ claims: { ...base, nonce: "someone-elses-nonce" } })],
    ["no nonce", () => signIdToken({ claims: { ...base } })],
    ["an unverified email", (nonce) => signIdToken({ claims: { ...base, nonce, email_verified: false } })],
    ["no email", (nonce) => signIdToken({ claims: { sub, name: "V", nonce } })],
    ["a token that is not a JWT", () => Promise.resolve("not-a-jwt")],
  ];

  it.each(cases)("rejects %s and creates no user or session", async (_label, token) => {
    const { res, sessionCookie } = await signIn({ sub, token });
    expect(res.headers.get("Location")).toBe("/?signin=failed");
    expect(sessionCookie).toBeUndefined();
    expect(await userBySub(sub)).toBeNull();
  });

  it("accepts the bare 'accounts.google.com' issuer Google also uses", async () => {
    const s = freshSub();
    const { sessionCookie } = await signIn({
      sub: s,
      token: (nonce) => signIdToken({ claims: { sub: s, nonce, email: "b@example.org" }, issuer: "accounts.google.com" }),
    });
    expect(sessionCookie).toBeDefined();
  });
});

describe("AUTH-2 First sign-in creates a Pending user", () => {
  it("creates a Pending member, records the first sign-in in the audit log, and lands on the request screen", async () => {
    const { res, sub, sessionCookie } = await signIn({ email: "new.volunteer@example.org", name: "New Volunteer" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/request-access");
    expect(sessionCookie).toBeDefined();

    const user = await userBySub(sub);
    expect(user).toMatchObject({
      email: "new.volunteer@example.org",
      name: "New Volunteer",
      avatar_url: "https://lh3.googleusercontent.com/a/test",
      status: "pending",
      app_role: "member",
    });
    const audit = await auditRows("user.first_sign_in", user!.id as number);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: user!.id, target_type: "user" });
    expect(audit[0]!.ip_hash).toMatch(/^[\w-]{43}$/);
  });

  it("matches a returning person by google_sub, refreshes email, name and photo, and does not log a second first sign-in", async () => {
    const sub = freshSub();
    await signIn({ sub, email: "old@example.org", name: "Old Name" });
    const first = await userBySub(sub);

    const { res } = await signIn({ sub, email: "new@example.org", name: "New Name", picture: "https://lh3.googleusercontent.com/a/new" });
    expect(res.headers.get("Location")).toBe("/request-access");
    const again = await userBySub(sub);
    expect(again!.id).toBe(first!.id);
    expect(again).toMatchObject({ email: "new@example.org", name: "New Name", avatar_url: "https://lh3.googleusercontent.com/a/new" });
    expect(await auditRows("user.first_sign_in", first!.id as number)).toHaveLength(1);
  });

  it("never matches on email: a different Google account with the same email is a separate user", async () => {
    const email = "shared@example.org";
    const a = await signIn({ email });
    const b = await signIn({ email });
    expect((await userBySub(a.sub))!.id).not.toBe((await userBySub(b.sub))!.id);
  });

  it("sends an approved member to the app instead of the request screen", async () => {
    const sub = freshSub();
    await signIn({ sub });
    await env.DB.prepare("UPDATE users SET status = 'active' WHERE google_sub = ?").bind(sub).run();
    const { res } = await signIn({ sub });
    expect(res.headers.get("Location")).toBe("/work");
  });

  it("does not start a session for a suspended user", async () => {
    const sub = freshSub();
    await signIn({ sub });
    await env.DB.prepare("UPDATE users SET status = 'suspended' WHERE google_sub = ?").bind(sub).run();
    const { res, sessionCookie } = await signIn({ sub });
    expect(res.headers.get("Location")).toBe("/?signin=suspended");
    expect(sessionCookie).toBeUndefined();
  });

  it("/api/auth/me returns the Pending user's profile and a CSRF token", async () => {
    const client = await signedInClient({ name: "Pat Pending" });
    const res = await request("/api/auth/me", { cookie: client.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { user: Record<string, unknown>; csrfToken: string };
    expect(body.user).toMatchObject({ name: "Pat Pending", status: "pending", appRole: "member", theme: "system" });
    expect(body.user).not.toHaveProperty("googleSub");
    expect(body.csrfToken).toMatch(/^[\w-]{43}$/);
  });
});
