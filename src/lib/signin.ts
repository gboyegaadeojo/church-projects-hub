import { AUTH_COPY, AUTH_ERRORS } from "../../shared/auth";

/**
 * Starts Google sign-in (section 7 step 1) and leaves for Google. Resolves only if it couldn't start,
 * with the copy to show: the RATE-1 message when rate-limited, otherwise the generic failure.
 * `invite` carries an invite token through sign-in so it is accepted on the way back (AUTH-9).
 */
export async function startGoogleSignIn(invite?: string): Promise<string> {
  try {
    const res = await fetch("/api/auth/start", {
      method: "POST",
      credentials: "same-origin",
      ...(invite ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invite }) } : {}),
    });
    const body = (await res.json()) as { url?: string; error?: string };
    if (res.ok && body.url) {
      window.location.assign(body.url);
      return new Promise(() => {}); // Keep any spinner going while the browser leaves for Google.
    }
    return body.error === AUTH_ERRORS.rateLimited ? AUTH_COPY.rateLimited : AUTH_COPY.signInFailed;
  } catch {
    return AUTH_COPY.signInFailed;
  }
}
