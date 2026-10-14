import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { z } from "zod";

// Google OAuth 2.0 with PKCE (section 7, NFR-2). Basic scopes only: openid, email, profile.

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/** The two calls that leave the Worker. Tests swap in a client backed by a local test key. */
export interface GoogleClient {
  /** Exchanges the authorization code (with the PKCE verifier) for Google's ID token. */
  exchangeCode(params: { code: string; codeVerifier: string; env: Env }): Promise<string>;
  /** Google's signing keys. */
  keys: JWTVerifyGetKey;
}

const tokenResponse = z.object({ id_token: z.string() });

// Module scope: the key set is fetched once per isolate and cached by jose (it honours key rotation).
const googleKeys = createRemoteJWKSet(new URL(JWKS_URL));

export const googleClient: GoogleClient = {
  async exchangeCode({ code, codeVerifier, env }) {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        code_verifier: codeVerifier,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) throw new Error(`Google token exchange failed with status ${res.status}`);
    return tokenResponse.parse(await res.json()).id_token;
  },
  keys: googleKeys,
};

export function authorizeUrl(params: { env: Env; state: string; nonce: string; codeChallenge: string }): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: params.env.GOOGLE_CLIENT_ID,
    redirect_uri: params.env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

export type GoogleIdentity = { sub: string; email: string; name: string; picture: string | null };

const idTokenClaims = z.object({
  sub: z.string().min(1),
  email: z.string().min(1),
  email_verified: z.literal(true),
  nonce: z.string(),
  name: z.string().optional(),
  picture: z.string().optional(),
});

/**
 * Full ID token check (section 7 step 2): RS256 signature against Google's keys, issuer, audience,
 * expiry, the nonce we sent, and a verified email. Throws on any failure.
 */
export async function verifyIdToken(
  idToken: string,
  opts: { keys: JWTVerifyGetKey; clientId: string; nonce: string },
): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(idToken, opts.keys, {
    issuer: GOOGLE_ISSUERS,
    audience: opts.clientId,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub"],
    clockTolerance: 30,
  });
  const claims = idTokenClaims.parse(payload);
  if (claims.nonce !== opts.nonce) throw new Error("ID token nonce mismatch");
  return {
    sub: claims.sub,
    email: claims.email,
    name: claims.name?.trim() || claims.email,
    picture: claims.picture ?? null,
  };
}
