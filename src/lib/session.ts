import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AUTH_ERRORS, CSRF_HEADER, meResponse, type MeResponse } from "../../shared/auth";

// Who is signed in, from GET /api/auth/me. Fetched once per page load (no polling, section 5);
// every authenticated API response re-checks the session server-side anyway.

export type SessionState =
  | { kind: "signed-in"; me: MeResponse }
  | { kind: "signed-out" }
  /** The session was revoked or expired (AUTH-7). */
  | { kind: "ended" }
  | { kind: "suspended" };

export const SESSION_QUERY_KEY = ["session"] as const;

async function fetchSession(): Promise<SessionState> {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (res.ok) return { kind: "signed-in", me: meResponse.parse(await res.json()) };
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (body.error === AUTH_ERRORS.sessionEnded) return { kind: "ended" };
  if (body.error === AUTH_ERRORS.suspended) return { kind: "suspended" };
  if (res.status === 401) return { kind: "signed-out" };
  throw new Error(`Session check failed with status ${res.status}`);
}

export function useSession() {
  return useQuery({ queryKey: SESSION_QUERY_KEY, queryFn: fetchSession, staleTime: Infinity, retry: 1 });
}

/** Where a signed-in person belongs: Pending users see only the request screen (section 2). */
export function homeFor(me: MeResponse): string {
  return me.user.status === "pending" ? "/request-access" : "/work";
}

/**
 * Every write carries the session's CSRF token (NFR-2). A 401 session_ended sends the person to
 * sign-in with "Your session has ended. Please sign in again." (AUTH-7).
 */
export async function apiWrite(path: string, csrfToken: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(CSRF_HEADER, csrfToken);
  const res = await fetch(path, { method: "POST", ...init, headers, credentials: "same-origin" });
  if (res.status === 401) window.location.assign("/?signin=ended");
  return res;
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return async (csrfToken: string) => {
    await apiWrite("/api/auth/logout", csrfToken).catch(() => undefined);
    queryClient.setQueryData<SessionState>(SESSION_QUERY_KEY, { kind: "signed-out" });
  };
}
