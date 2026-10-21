import { z } from "zod";

// Access requests, approvals and invites — contract shared by the Worker and the app
// (sections 2, 7, 11.6, 11.7; AUTH-3, AUTH-5, AUTH-8, AUTH-9, RATE-2).

export const PROJECT_ROLE_VALUES = ["admin", "contributor", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLE_VALUES)[number];
export const projectRole = z.enum(PROJECT_ROLE_VALUES);

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  admin: "Project Admin",
  contributor: "Contributor",
  viewer: "Viewer",
};

/** Default role when approving a request (section 7). */
export const DEFAULT_APPROVAL_ROLE: ProjectRole = "contributor";

/** Exact copy from sections 7, 11.6, 11.7 and 14. */
export const ACCESS_COPY = {
  rateLimited: "You've submitted the maximum requests for today. Check back tomorrow, or contact an admin directly.",
  reviewPromise: "A team admin will review your request. We aim to respond within 48 hours.",
  stillWaiting: "Still waiting? Send a reminder to the project admin.",
  inviteExpired: "This invitation has expired. Contact the project admin to request a new one.",
  inviteMismatch:
    "This invitation was sent to a different email address. Sign in with that Google account, or ask the project admin for a new invite.",
  noProjects: "You haven't been added to any projects yet. Request access to get started.",
} as const;

export const ACCESS_ERRORS = {
  forbidden: "forbidden",
  notFound: "not_found",
  invalid: "invalid",
  rateLimited: "rate_limited",
  alreadyDecided: "already_decided",
  requesterSuspended: "requester_suspended",
  alreadyRequested: "already_requested",
  nudgeNotAvailable: "nudge_not_available",
  confirmationRequired: "confirmation_required",
  /** v4.7: a Project Admin tried to demote or remove their project's last admin. */
  lastProjectAdmin: "last_project_admin",
} as const;

/** RATE-2 / NFR-4: requests per user per calendar day in their timezone; one per project. */
export const ACCESS_REQUESTS_PER_DAY = 5;
/** AUTH-8: the nudge appears after 48 hours and can be sent once per 24 hours per request. */
export const NUDGE_AFTER_MS = 48 * 60 * 60 * 1000;
export const NUDGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Section 11.6: the status screen polls every 30 s while visible. */
export const STATUS_POLL_MS = 30_000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Header the confirmation dialog sends for destructive actions (section 11.14); 428 without it. */
export const CONFIRM_HEADER = "X-Confirm-Action";
export const CONFIRM_ACTIONS = {
  denyAccessRequest: "access_request.deny",
} as const;

export const NOTE_MAX = 500;
export const REASON_MAX = 500;

// ---- Requests

export const projectTile = z.object({
  id: z.number().int(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  colour: z.string(),
  icon: z.string(),
});
export type ProjectTile = z.infer<typeof projectTile>;
export const requestableProjectsResponse = z.object({ projects: z.array(projectTile) });

export const createAccessRequestBody = z.object({
  projectIds: z
    .array(z.number().int().positive())
    .min(1, "Choose at least one project.")
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, "Each project can be chosen once."),
  note: z.string().trim().max(NOTE_MAX, `Keep the note under ${NOTE_MAX} characters.`).default(""),
});
export type CreateAccessRequestBody = z.input<typeof createAccessRequestBody>;

export const ACCESS_REQUEST_STATUS_VALUES = ["pending", "approved", "denied", "withdrawn"] as const;

export const myAccessRequest = z.object({
  id: z.number().int(),
  status: z.enum(ACCESS_REQUEST_STATUS_VALUES),
  project: projectTile.pick({ id: true, key: true, name: true, colour: true, icon: true }),
  decisionReason: z.string().nullable(),
  createdAt: z.number(),
  /** Pending for more than 48 hours: show "Still waiting?". */
  stillWaiting: z.boolean(),
  /** The nudge can be sent now (not sent in the last 24 hours). */
  canNudge: z.boolean(),
});
export type MyAccessRequest = z.infer<typeof myAccessRequest>;
export const myAccessRequestsResponse = z.object({ requests: z.array(myAccessRequest) });

// ---- Decisions

export const approveBody = z.object({ role: projectRole.default(DEFAULT_APPROVAL_ROLE) });
export const denyBody = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Give a short reason. It's shown to the person who asked.")
    .max(REASON_MAX, `Keep the reason under ${REASON_MAX} characters.`),
});

export const queueRequest = z.object({
  id: z.number().int(),
  note: z.string(),
  createdAt: z.number(),
  requester: z.object({ id: z.number().int(), name: z.string(), email: z.string(), avatarUrl: z.string().nullable() }),
  project: projectTile.pick({ id: true, key: true, name: true }),
  /** No active Project Admin: App Admins decide (section 7). */
  noProjectAdmin: z.boolean(),
});
export type QueueRequest = z.infer<typeof queueRequest>;
export const accessQueueResponse = z.object({
  requests: z.array(queueRequest),
  /** Projects this person can invite people to. */
  invitableProjects: z.array(projectTile.pick({ id: true, key: true, name: true })),
});
export type AccessQueueResponse = z.infer<typeof accessQueueResponse>;

// ---- Invites

export const createInviteBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter an email address, like name@example.com.")),
  role: projectRole,
});
export const createInviteResponse = z.object({ link: z.url(), expiresAt: z.number() });

export const inviteToken = z.string().regex(/^[\w-]{43}$/);

export const inviteLookupResponse = z.discriminatedUnion("status", [
  z.object({ status: z.literal("valid"), projectName: z.string(), role: projectRole }),
  z.object({ status: z.literal("expired") }),
]);
export type InviteLookup = z.infer<typeof inviteLookupResponse>;

export const INVITE_OUTCOMES = ["accepted", "expired", "mismatch"] as const;
export type InviteOutcome = (typeof INVITE_OUTCOMES)[number];
export const acceptInviteResponse = z.object({ outcome: z.enum(INVITE_OUTCOMES) });
