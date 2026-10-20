import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AUTH_ERRORS, meResponse, type MeResponse } from "../../shared/auth";
import { api, UNAVAILABLE_ERROR } from "./api";
import { setMaintenance } from "./maintenance";
import { isOnline } from "./online";

// Who is signed in, from GET /api/auth/me. Fetched once per page load (no polling, section 5);
// every authenticated API response re-checks the session server-side anyway.

export type SessionState =
  | { kind: "signed-in"; me: MeResponse }
  | { kind: "signed-out" }
  /** The session was revoked or expired (AUTH-7). */
  | { kind: "ended" }
  | { kind: "suspended" }
  /** Offline with nothing saved on this device to show (NFR-20). */
  | { kind: "offline" };

export const SESSION_QUERY_KEY = ["session"] as const;

/** The service worker's cache of API reads (vite.config.ts); emptied on sign-out. */
export const API_CACHE = "cph-api";

async function fetchSession(): Promise<SessionState> {
  let res: Response;
  try {
    res = await fetch("/api/auth/me", { credentials: "same-origin" });
  } catch (err) {
    if (!isOnline()) return { kind: "offline" };
    throw err;
  }
  if (res.ok) return { kind: "signed-in", me: meResponse.parse(await res.json()) };
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (body.error === AUTH_ERRORS.sessionEnded) return { kind: "ended" };
  if (body.error === AUTH_ERRORS.suspended) return { kind: "suspended" };
  if (res.status === 503 && body.error === UNAVAILABLE_ERROR) {
    setMaintenance(true);
    throw new Error("unavailable");
  }
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

export function useSignOut() {
  const queryClient = useQueryClient();
  return async (csrfToken: string) => {
    await api("/api/auth/logout", { method: "POST", csrfToken }).catch(() => undefined);
    // Shared devices: nothing of this person's stays readable offline after they sign out.
    if (typeof caches !== "undefined") await caches.delete(API_CACHE).catch(() => undefined);
    queryClient.clear();
    queryClient.setQueryData<SessionState>(SESSION_QUERY_KEY, { kind: "signed-out" });
  };
}
