// Drizzle schema — tables from docs/REQUIREMENTS.md section 6.
// Tables are added stage by stage; run `npm run db:generate` after each change,
// review the SQL in migrations/, then `npm run db:migrate:local`.
//
// Conventions: integer ids (except sessions); times are epoch milliseconds; booleans are 0/1.
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const nowMs = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

// Every table carries created_at, updated_at and created_by (section 6).
// created_by is null when the row was made by the system or by the person themselves on first sign-in.
const timestamps = {
  createdAt: integer("created_at").notNull().default(nowMs),
  updatedAt: integer("updated_at").notNull().default(nowMs),
  createdBy: integer("created_by").references((): AnySQLiteColumn => users.id),
};

export const APP_ROLES = ["admin", "member"] as const;
export const USER_STATUSES = ["pending", "active", "suspended"] as const;
export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export const PROJECT_ROLES = ["admin", "contributor", "viewer"] as const;
export const ACCESS_REQUEST_STATUSES = ["pending", "approved", "denied", "withdrawn"] as const;
export const WORKFLOW_CATEGORIES = ["todo", "in_progress", "done"] as const;

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(", ")})`);

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Google's stable account id. Users are matched on this, never on email (section 7).
    googleSub: text("google_sub").notNull().unique(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    appRole: text("app_role", { enum: APP_ROLES }).notNull().default("member"),
    status: text("status", { enum: USER_STATUSES }).notNull().default("pending"),
    timezone: text("timezone").notNull().default("America/Winnipeg"),
    // Theme preference stored on the profile (carried over from Stage 1); wired up in Stage 2c.
    theme: text("theme", { enum: THEME_PREFERENCES }).notNull().default("system"),
    // Written at most every 15 minutes (NFR-23).
    lastSeenAt: integer("last_seen_at"),
    deletedAt: integer("deleted_at"),
    deletionRequestedAt: integer("deletion_requested_at"),
    ...timestamps,
  },
  (t) => [
    check("users_app_role_check", oneOf("app_role", APP_ROLES)),
    check("users_status_check", oneOf("status", USER_STATUSES)),
    check("users_theme_check", oneOf("theme", THEME_PREFERENCES)),
    index("users_app_role_status_idx").on(t.appRole, t.status),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    // Random 256-bit value, base64url. Sent to the browser only inside a signed HttpOnly cookie.
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    expiresAt: integer("expires_at").notNull(),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    // Checked on every authenticated request (AUTH-6, AUTH-7).
    revokedAt: integer("revoked_at"),
    ...timestamps,
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const projects = sqliteTable(
  "projects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    colour: text("colour").notNull(),
    icon: text("icon").notNull(),
    archivedAt: integer("archived_at"),
    // Incremented in the same transaction as each task insert so keys never collide.
    nextTaskNumber: integer("next_task_number").notNull().default(1),
    // Invite-only (PROJ-6).
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    // The built-in Hub Feedback project (PROJ-7): admin-only, cannot be archived or deleted.
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    deletedAt: integer("deleted_at"),
    ...timestamps,
  },
);

export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: PROJECT_ROLES }).notNull(),
    addedBy: integer("added_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    check("project_members_role_check", oneOf("role", PROJECT_ROLES)),
    index("project_members_user_id_idx").on(t.userId),
  ],
);

export const accessRequests = sqliteTable(
  "access_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    note: text("note").notNull().default(""),
    status: text("status", { enum: ACCESS_REQUEST_STATUSES }).notNull().default("pending"),
    decidedBy: integer("decided_by").references(() => users.id),
    decidedAt: integer("decided_at"),
    decisionReason: text("decision_reason"),
    // "Still waiting?" nudge (AUTH-8): at most once per 24 hours per request.
    lastNudgedAt: integer("last_nudged_at"),
    ...timestamps,
  },
  (t) => [
    check("access_requests_status_check", oneOf("status", ACCESS_REQUEST_STATUSES)),
    index("access_requests_project_id_status_idx").on(t.projectId, t.status),
    // RATE-2 counts a user's requests created today.
    index("access_requests_user_id_created_at_idx").on(t.userId, t.createdAt),
    // One open request per user per project (section 6).
    uniqueIndex("access_requests_one_open_idx")
      .on(t.userId, t.projectId)
      .where(sql`status = 'pending'`),
  ],
);

export const invites = sqliteTable(
  "invites",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    role: text("role", { enum: PROJECT_ROLES }).notNull(),
    email: text("email").notNull(),
    invitedBy: integer("invited_by")
      .notNull()
      .references(() => users.id),
    // SHA-256 of the random 256-bit token in the invite link, so the table holds no usable links.
    // Single-use, expires after 7 days (AUTH-9).
    token: text("token").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    ...timestamps,
  },
  (t) => [
    check("invites_role_check", oneOf("role", PROJECT_ROLES)),
    uniqueIndex("invites_token_idx").on(t.token),
    index("invites_project_id_used_at_idx").on(t.projectId, t.usedAt),
  ],
);

export const workflowStates = sqliteTable(
  "workflow_states",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    // Reports use the category so renamed columns don't break charts.
    category: text("category", { enum: WORKFLOW_CATEGORIES }).notNull(),
    position: integer("position").notNull(),
    ...timestamps,
  },
  (t) => [
    check("workflow_states_category_check", oneOf("category", WORKFLOW_CATEGORIES)),
    index("workflow_states_project_id_position_idx").on(t.projectId, t.position),
  ],
);

// Append-only (ADM-3). Rows are never updated, so `at` stands in for created_at/updated_at
// and actor_id for created_by. actor_id is null for system events.
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorId: integer("actor_id").references(() => users.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    detailJson: text("detail_json").notNull().default("{}"),
    ipHash: text("ip_hash"),
    at: integer("at").notNull().default(nowMs),
  },
  (t) => [index("audit_log_at_idx").on(t.at), index("audit_log_action_at_idx").on(t.action, t.at)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
