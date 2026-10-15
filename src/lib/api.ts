import { AUTH_ERRORS, CSRF_HEADER } from "../../shared/auth";

// One way to call the API from the app. It sends the CSRF token on writes (NFR-2) and handles the
// two security states the same way everywhere:
// - session ended or revoked → sign-in with "Your session has ended. Please sign in again." (AUTH-7)
// - suspended → the suspended screen (section 11.7)

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

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (opts.csrfToken) headers.set(CSRF_HEADER, opts.csrfToken);
  if (opts.body !== undefined) headers.set("Content-Type", "application/json");
  const res = await fetch(path, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: "same-origin",
  });
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.ok) return body as T;

  if (body?.error === AUTH_ERRORS.sessionEnded) window.location.assign("/?signin=ended");
  else if (body?.error === AUTH_ERRORS.suspended) window.location.assign("/suspended");
  throw new ApiError(res.status, body?.error, body);
}
