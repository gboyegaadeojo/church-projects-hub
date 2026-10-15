import { env } from "cloudflare:workers";
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { createApp } from "../../worker/app";
import type { GoogleClient } from "../../worker/auth/google";

// Test harness for sign-in. Google's two network calls are replaced by a local RSA key pair;
// the ID token verification, sessions, D1 and rate limiter are all the real code.

export const ORIGIN = "https://hub.test";

const signingKey = await generateKeyPair("RS256");
const otherKey = await generateKeyPair("RS256");
const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "test-key", alg: "RS256" };

type TokenOptions = {
  claims?: JWTPayload & Record<string, unknown>;
  /** Sign with a key Google never published. */
  wrongKey?: boolean;
  issuer?: string;
  audience?: string;
  /** Seconds relative to now. */
  expiresIn?: number;
};

export function signIdToken(opts: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email_verified: true, ...opts.claims })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(opts.issuer ?? "https://accounts.google.com")
    .setAudience(opts.audience ?? env.GOOGLE_CLIENT_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expiresIn ?? 3600))
    .sign(opts.wrongKey ? otherKey.privateKey : signingKey.privateKey);
}

/** What the fake Google returns from the token exchange; set per sign-in. */
let nextToken: (nonce: string) => Promise<string> = () => Promise.reject(new Error("no token configured"));
export const exchangedCodes: { code: string; codeVerifier: string }[] = [];

const fakeGoogle: GoogleClient = {
  async exchangeCode({ code, codeVerifier }) {
    exchangedCodes.push({ code, codeVerifier });
    return nextToken(pendingNonce);
  },
  keys: createLocalJWKSet({ keys: [publicJwk] }),
};
let pendingNonce = "";

export const app = createApp({ google: fakeGoogle });

let ipCounter = 0;
/** A fresh client IP, so RATE-1 counts from zero for each test. */
export function freshIp(): string {
  ipCounter += 1;
  return `198.51.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

let subCounter = 0;
export function freshSub(): string {
  subCounter += 1;
  return `google-sub-${crypto.randomUUID()}-${subCounter}`;
}

/** `name=value` for each Set-Cookie on a response. */
export function cookiesFrom(res: Response): Record<string, { value: string; raw: string }> {
  const out: Record<string, { value: string; raw: string }> = {};
  for (const raw of res.headers.getSetCookie()) {
    const [pair = ""] = raw.split(";");
    const eq = pair.indexOf("=");
    out[pair.slice(0, eq)] = { value: pair.slice(eq + 1), raw };
  }
  return out;
}

export function request(path: string, init: RequestInit & { ip?: string; cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", init.ip ?? "203.0.113.1");
  if (init.cookie) headers.set("Cookie", init.cookie);
  const method = init.method ?? "GET";
  if (method !== "GET" && !headers.has("Origin")) headers.set("Origin", ORIGIN);
  return app.request(`${ORIGIN}${path}`, { ...init, method, headers }, env);
}

export async function startSignIn(ip: string, invite?: string) {
  const res = await request("/api/auth/start", {
    method: "POST",
    ip,
    ...(invite ? { body: JSON.stringify({ invite }), headers: { "Content-Type": "application/json" } } : {}),
  });
  const body = (await res.json()) as { url?: string; error?: string; message?: string };
  const oauthCookie = cookiesFrom(res)["__Host-cph_oauth"];
  return { res, body, oauthCookie, url: body.url ? new URL(body.url) : undefined };
}

type SignInOptions = {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
  ip?: string;
  /** Override how the ID token is made (for the rejection tests). */
  token?: (nonce: string) => Promise<string>;
  /** Override the state sent back on the callback. */
  state?: string;
  /** Invite token from an invite link, accepted during sign-in (AUTH-9). */
  invite?: string;
};

/** The whole browser round trip: /start, Google, /callback. Returns the callback response and session cookie. */
export async function signIn(opts: SignInOptions = {}) {
  const ip = opts.ip ?? freshIp();
  const sub = opts.sub ?? freshSub();
  const start = await startSignIn(ip, opts.invite);
  if (!start.url || !start.oauthCookie) throw new Error(`start failed: ${start.res.status}`);
  pendingNonce = start.url.searchParams.get("nonce") ?? "";
  nextToken =
    opts.token ??
    ((nonce) =>
      signIdToken({
        claims: {
          sub,
          nonce,
          email: opts.email ?? `${sub}@example.org`,
          name: opts.name ?? "Test Volunteer",
          picture: opts.picture ?? "https://lh3.googleusercontent.com/a/test",
        },
      }));
  const state = opts.state ?? start.url.searchParams.get("state") ?? "";
  const res = await request(`/api/auth/callback?code=test-code&state=${encodeURIComponent(state)}`, {
    ip,
    cookie: `__Host-cph_oauth=${start.oauthCookie.value}`,
  });
  const session = cookiesFrom(res)["__Host-cph_session"];
  return { res, sub, ip, start, sessionCookie: session ? `__Host-cph_session=${session.value}` : undefined, session };
}

/** Signs in and fetches /api/auth/me, returning what an authenticated client holds. */
export async function signedInClient(opts: SignInOptions = {}) {
  const signedIn = await signIn(opts);
  if (!signedIn.sessionCookie) throw new Error(`sign-in failed: ${signedIn.res.headers.get("Location")}`);
  const me = await request("/api/auth/me", { cookie: signedIn.sessionCookie });
  const body = (await me.json()) as { user: { id: number }; csrfToken: string };
  return { ...signedIn, cookie: signedIn.sessionCookie, userId: body.user.id, csrfToken: body.csrfToken };
}

export type Client = Awaited<ReturnType<typeof signedInClient>>;

/** An API call as a signed-in person: session cookie, CSRF token on writes, JSON body. */
export function call(
  client: Pick<Client, "cookie" | "csrfToken" | "ip">,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return request(path, {
    method,
    ip: client.ip,
    cookie: client.cookie,
    headers: {
      ...(method === "GET" ? {} : { "X-CSRF-Token": client.csrfToken }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
