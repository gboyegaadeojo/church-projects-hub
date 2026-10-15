import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// People, projects, requests and invites for the access e2e tests, seeded into the e2e server's own
// local D1 by prepare-db.ts. Sessions are seeded too, so tests skip Google and sign in by cookie.
// Plain TypeScript only (no enums): Node runs prepare-db.ts with type stripping.
// No children's details or pastoral information here (NFR-24).

export const VIEWPORTS = ["desktop", "mobile"] as const;
export type Viewport = (typeof VIEWPORTS)[number];

export const HOUR = 60 * 60 * 1000;

export const PROJECTS = [
  { id: 1, key: "MEDIA", name: "Media", description: "Sound, lighting, stream and slides." },
  { id: 2, key: "WELCOME", name: "Welcome team", description: "Greeters, coffee and newcomer follow-up." },
  { id: 3, key: "HOSP", name: "Hospitality", description: "Meals and events after services." },
  // Invite-only (PROJ-6): never offered on the request screen.
  { id: 4, key: "LEAD", name: "Leadership", description: "Planning for the leadership team.", hidden: true },
] as const;

type Membership = { projectId: number; role: "admin" | "contributor" | "viewer" };

export type Persona = {
  id: number;
  key: string;
  name: string;
  email: string;
  status: "pending" | "active" | "suspended";
  appRole: "admin" | "member";
  memberships: Membership[];
};

/** Shared people are only read; people who change state get one copy per viewport, so runs never collide. */
const SHARED: Omit<Persona, "id">[] = [
  { key: "admin", name: "Grace Admin", email: "grace.admin@example.org", status: "active", appRole: "admin", memberships: [] },
  {
    key: "contributor",
    name: "Sam Contributor",
    email: "sam.contributor@example.org",
    status: "active",
    appRole: "member",
    memberships: [{ projectId: 1, role: "contributor" }],
  },
  { key: "pendingNew", name: "Pat Newcomer", email: "pat.newcomer@example.org", status: "pending", appRole: "member", memberships: [] },
  { key: "pendingWaiting", name: "Robin Waiting", email: "robin.waiting@example.org", status: "pending", appRole: "member", memberships: [] },
  { key: "wrongAccount", name: "Alex Otheraccount", email: "alex.other@example.org", status: "pending", appRole: "member", memberships: [] },
  { key: "suspended", name: "Jordan Suspended", email: "jordan.suspended@example.org", status: "suspended", appRole: "member", memberships: [] },
  // Approved but in no project yet (section 11.1 empty state).
  { key: "loner", name: "Lee Newmember", email: "lee.newmember@example.org", status: "active", appRole: "member", memberships: [] },
];

const PER_VIEWPORT = ["submitter", "nudger", "approvee", "denyee", "invitee"] as const;
/** Active Media contributors whose settings change (theme on the profile). */
const PER_VIEWPORT_ACTIVE = ["themer"] as const;
type PerViewportKey = (typeof PER_VIEWPORT)[number] | (typeof PER_VIEWPORT_ACTIVE)[number];

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const PERSONAS: Persona[] = [
  ...SHARED,
  ...VIEWPORTS.flatMap((v) =>
    PER_VIEWPORT.map((k) => ({
      key: `${k}-${v}`,
      name: `${titleCase(k)} ${titleCase(v)}`,
      email: `${k}.${v}@example.org`,
      status: "pending" as const,
      appRole: "member" as const,
      memberships: [],
    })),
  ),
  ...VIEWPORTS.flatMap((v) =>
    PER_VIEWPORT_ACTIVE.map((k) => ({
      key: `${k}-${v}`,
      name: `${titleCase(k)} ${titleCase(v)}`,
      email: `${k}.${v}@example.org`,
      status: "active" as const,
      appRole: "member" as const,
      memberships: [{ projectId: 1, role: "contributor" as const }],
    })),
  ),
].map((p, i) => ({ ...p, id: i + 1 }));

type SharedKey = "admin" | "contributor" | "pendingNew" | "pendingWaiting" | "wrongAccount" | "suspended" | "loner";

export function persona(key: SharedKey): Persona;
export function persona(key: PerViewportKey, viewport: Viewport): Persona;
export function persona(key: string, viewport?: Viewport): Persona {
  const full = viewport ? `${key}-${viewport}` : key;
  const found = PERSONAS.find((p) => p.key === full);
  if (!found) throw new Error(`No e2e persona ${full}`);
  return found;
}

export const DENIAL_REASON = "The team is full this season.";

/** Requests in place before the tests run. `ageHours` is how long ago each was made. */
export const REQUESTS: { personaKey: string; projectId: number; status: "pending" | "denied"; ageHours: number; note?: string; reason?: string }[] = [
  { personaKey: "pendingWaiting", projectId: 1, status: "pending", ageHours: 72, note: "I can run slides." },
  { personaKey: "pendingWaiting", projectId: 2, status: "denied", ageHours: 96, reason: DENIAL_REASON },
  ...VIEWPORTS.flatMap((v) => [
    // AUTH-8: past 48 hours, never nudged.
    { personaKey: `nudger-${v}`, projectId: 1, status: "pending" as const, ageHours: 72 },
    { personaKey: `approvee-${v}`, projectId: 2, status: "pending" as const, ageHours: 1, note: "Happy to help on Sundays." },
    { personaKey: `denyee-${v}`, projectId: 2, status: "pending" as const, ageHours: 1 },
  ]),
];

/** Invite tokens are 43 base64url characters (shared/access.ts inviteToken). */
const token = (label: string) => label.padEnd(43, "0");

export const INVITES = {
  /** Valid, for someone who never signs in here: the signed-out landing and the mismatch screen. */
  elsewhere: { token: token("e2e-invite-elsewhere-"), email: "invited.elsewhere@example.org", projectId: 3, role: "viewer", expiresInHours: 24 * 6 },
  expired: { token: token("e2e-invite-expired-"), email: "pat.newcomer@example.org", projectId: 3, role: "contributor", expiresInHours: -1 },
} as const;

/** The invite table stores SHA-256 of the token, base64url (worker/lib/crypto.ts sha256Base64url). */
export function hashInviteToken(t: string): string {
  return createHash("sha256").update(t).digest("base64url");
}

/** One long-lived session per persona; the id is a credential, but only for this throwaway database. */
export function sessionIdFor(p: Persona): string {
  return `e2e-session-${p.key}`;
}

const DEV_VARS = fileURLToPath(new URL("../../.dev.vars", import.meta.url));

/** SESSION_SECRET from .dev.vars, which the e2e server also reads. */
export function sessionSecret(): string {
  const line = readFileSync(DEV_VARS, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("SESSION_SECRET="));
  const secret = line?.slice("SESSION_SECRET=".length).trim();
  if (!secret) throw new Error("SESSION_SECRET is missing from .dev.vars");
  return secret;
}

/** The `__Host-cph_session` value, signed exactly like Hono's setSignedCookie (worker/auth/session.ts). */
export function signedSessionCookie(sessionId: string, secret: string): string {
  const value = encodeURIComponent(sessionId);
  const signature = createHmac("sha256", secret).update(value).digest("base64");
  return encodeURIComponent(`${value}.${signature}`);
}
