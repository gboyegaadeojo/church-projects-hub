import { AUTH_ERRORS, CSRF_HEADER } from "../../shared/auth";
import { UNREAD_HEADER } from "../../shared/notifications";
import { setMaintenance } from "./maintenance";
import { setUnread } from "./notifications";
import { isOnline } from "./online";

// One way to call the API from the app. It sends the CSRF token on writes (NFR-2) and handles the
// security and availability states the same way everywhere:
// - session ended or revoked → sign-in with "Your session has ended. Please sign in again." (AUTH-7)
// - suspended → the suspended screen (section 11.7)
// - the database is unavailable → the maintenance page (NFR-18)
// - offline → writes are refused before they're sent (section 11.10: no edits offline in v1)

export type ApiOptions = {
  method?: string;
  body?: unknown;
  /** Required for writes: from GET /api/auth/me. */
  csrfToken?: string;
  /** Extra headers, e.g. the confirmation header from ConfirmDialog. */
  headers?: Record<string, string>;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly body: unknown,
  ) {
    super(`API ${status}${code ? ` ${code}` : ""}`);
  }
}

/** `code` of the ApiError thrown for a write attempted offline. */
export const OFFLINE_ERROR = "offline";
/** The `error` the Worker sends with 503 when D1 is unavailable (NFR-18). */
export const UNAVAILABLE_ERROR = "unavailable";

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  if (method !== "GET" && !isOnline()) throw new ApiError(0, OFFLINE_ERROR, null);
  const headers = new Headers(opts.headers);
  if (opts.csrfToken) headers.set(CSRF_HEADER, opts.csrfToken);
  if (opts.body !== undefined) headers.set("Content-Type", "application/json");
  const res = await fetch(path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: "same-origin",
  });
  // Section 11.8: every signed-in response carries the unread count for the bell.
  const unreadHeader = res.headers.get(UNREAD_HEADER);
  if (unreadHeader !== null) setUnread(Number(unreadHeader));
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.ok) return body as T;

  if (body?.error === AUTH_ERRORS.sessionEnded) window.location.assign("/?signin=ended");
  else if (body?.error === AUTH_ERRORS.suspended) window.location.assign("/suspended");
  else if (res.status === 503 && body?.error === UNAVAILABLE_ERROR) setMaintenance(true);
  throw new ApiError(res.status, body?.error, body);
}
