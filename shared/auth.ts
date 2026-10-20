import { z } from "zod";

// Sign-in and session contract shared by the Worker and the React app (sections 7, 11.6, 11.7, 14).

/** User-facing copy. Exact wording from section 14; never shows an error code. */
export const AUTH_COPY = {
  rateLimited: "Too many sign-in attempts. Please wait a minute and try again.",
  sessionEnded: "Your session has ended. Please sign in again.",
  suspended: "Your access has been suspended. If you think this is an error, contact an app administrator.",
  // Cancelled consent, unverified email, Google error.
  signInFailed: "Sign-in didn't work. Please try again.",
  accountHint: "Use the same Google account each time.",
  contactEmail: "media@ifcwpg.com",
} as const;

/** Machine-readable `error` values in API responses. The client maps them to copy; users never see them. */
export const AUTH_ERRORS = {
  unauthenticated: "unauthenticated",
  sessionEnded: "session_ended",
  suspended: "suspended",
  csrf: "csrf_failed",
  rateLimited: "rate_limited",
} as const;

/** `?signin=` values the callback redirects home with. */
export const SIGNIN_OUTCOMES = ["failed", "ended"] as const;
export type SignInOutcome = (typeof SIGNIN_OUTCOMES)[number];

/** Header that carries the CSRF token on every write (NFR-2). */
export const CSRF_HEADER = "X-CSRF-Token";

export const startSignInResponse = z.object({ url: z.url() });

export const meResponse = z.object({
  user: z.object({
    id: z.number().int(),
    email: z.string(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
    appRole: z.enum(["admin", "member"]),
    status: z.enum(["pending", "active", "suspended"]),
    theme: z.enum(["light", "dark", "system"]),
    /** IANA timezone; all dates show in it (section 11.1). */
    timezone: z.string(),
  }),
  csrfToken: z.string(),
  /** App Admin, or Project Admin of at least one project: show the access queue link. */
  canReviewAccess: z.boolean(),
  /** How many times this person has signed in; the add-to-home-screen prompt waits for the second (NFR-21). */
  signInCount: z.number().int().default(1),
});
export type MeResponse = z.infer<typeof meResponse>;

export const apiError = z.object({ error: z.string(), message: z.string().optional() });
