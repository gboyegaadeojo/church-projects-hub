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
    // ADM-8: when they were suspended; six months later their details are eligible for purge.
    suspendedAt: integer("suspended_at"),
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
    // ADM-7: an admin cancelled it before it was used.
    cancelledAt: integer("cancelled_at"),
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

// ---- Tasks (Stage 3: TASK, ORG, NAV)

export const TASK_TYPES = ["task", "bug", "idea", "epic"] as const;
export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export const SCOPES = ["in_scope", "out_of_scope", "parked"] as const;

export const labels = sqliteTable(
  "labels",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    colour: text("colour").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("labels_project_id_name_idx").on(t.projectId, sql`${t.name} COLLATE NOCASE`)],
);

export const components = sqliteTable(
  "components",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    leadId: integer("lead_id").references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("components_project_id_name_idx").on(t.projectId, sql`${t.name} COLLATE NOCASE`)],
);

export const milestones = sqliteTable(
  "milestones",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    // Calendar date YYYY-MM-DD, like due dates.
    targetDate: text("target_date"),
    releasedAt: integer("released_at"),
    ...timestamps,
  },
  (t) => [index("milestones_project_id_idx").on(t.projectId)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    // From projects.next_task_number in the same batch as the insert, so keys (MEDIA-42) never collide.
    number: integer("number").notNull(),
    title: text("title").notNull(),
    // Tiptap JSON (section 11.5), validated by shared/richtext.ts; description_text is the plain-text copy.
    descriptionJson: text("description_json").notNull().default('{"type":"doc","content":[]}'),
    descriptionText: text("description_text").notNull().default(""),
    type: text("type", { enum: TASK_TYPES }).notNull().default("task"),
    stateId: integer("state_id")
      .notNull()
      .references(() => workflowStates.id),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("medium"),
    scope: text("scope", { enum: SCOPES }).notNull().default("in_scope"),
    assigneeId: integer("assignee_id").references(() => users.id),
    reporterId: integer("reporter_id")
      .notNull()
      .references(() => users.id),
    // Calendar date YYYY-MM-DD, no time (section 11.3).
    dueDate: text("due_date"),
    epicId: integer("epic_id").references((): AnySQLiteColumn => tasks.id),
    componentId: integer("component_id").references(() => components.id),
    milestoneId: integer("milestone_id").references(() => milestones.id),
    // Fractional index within the column (fractional-indexing), compared with plain string order.
    rank: text("rank").notNull(),
    // Optimistic concurrency (NFR-10): every change increments it.
    version: integer("version").notNull().default(0),
    deletedAt: integer("deleted_at"),
    ...timestamps,
  },
  (t) => [
    check("tasks_type_check", oneOf("type", TASK_TYPES)),
    check("tasks_priority_check", oneOf("priority", PRIORITIES)),
    check("tasks_scope_check", oneOf("scope", SCOPES)),
    uniqueIndex("tasks_project_id_number_idx").on(t.projectId, t.number),
    index("tasks_project_id_state_id_rank_idx").on(t.projectId, t.stateId, t.rank),
    index("tasks_assignee_id_due_date_idx").on(t.assigneeId, t.dueDate),
    index("tasks_epic_id_idx").on(t.epicId),
  ],
);

export const taskLabels = sqliteTable(
  "task_labels",
  {
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id),
    labelId: integer("label_id")
      .notNull()
      .references(() => labels.id),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.labelId] }), index("task_labels_label_id_idx").on(t.labelId)],
);

export const subtasks = sqliteTable(
  "subtasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id),
    title: text("title").notNull(),
    done: integer("done", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull(),
    ...timestamps,
  },
  (t) => [index("subtasks_task_id_position_idx").on(t.taskId, t.position)],
);

export const comments = sqliteTable(
  "comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id),
    authorId: integer("author_id")
      .notNull()
      .references(() => users.id),
    bodyJson: text("body_json").notNull(),
    bodyText: text("body_text").notNull(),
    // TASK-4: edits show "edited".
    editedAt: integer("edited_at"),
    deletedAt: integer("deleted_at"),
    ...timestamps,
  },
  (t) => [index("comments_task_id_idx").on(t.taskId)],
);

// @mentions parsed from descriptions and comments on save (section 11.5); My Work's "Mentioned me" (NAV-3).
export const mentions = sqliteTable(
  "mentions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id),
    // Null when the mention is in the task description.
    commentId: integer("comment_id").references(() => comments.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    // Set when the person opens the task; unread mentions show on My Work.
    seenAt: integer("seen_at"),
    ...timestamps,
  },
  (t) => [index("mentions_user_id_seen_at_idx").on(t.userId, t.seenAt), index("mentions_task_id_idx").on(t.taskId)],
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id),
    r2Key: text("r2_key").notNull().unique(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    uploadedBy: integer("uploaded_by")
      .notNull()
      .references(() => users.id),
    deletedAt: integer("deleted_at"),
    // When the R2 object was removed. A deleted row without it is retried by the daily clean-up.
    purgedAt: integer("purged_at"),
    ...timestamps,
  },
  (t) => [index("attachments_task_id_idx").on(t.taskId)],
);

// TASK-8: assignee and reporter are added automatically.
export const watchers = sqliteTable(
  "watchers",
  {
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] }), index("watchers_user_id_idx").on(t.userId)],
);

// TASK-6 history and every report (section 16). Append-only, like the audit log.
export const taskEvents = sqliteTable(
  "task_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id),
    actorId: integer("actor_id").references(() => users.id),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    at: integer("at").notNull().default(nowMs),
  },
  (t) => [index("task_events_task_id_at_idx").on(t.taskId, t.at)],
);

// ORG-5: saved filters, private or shared to the project.
export const savedFilters = sqliteTable(
  "saved_filters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    queryJson: text("query_json").notNull(),
    shared: integer("shared", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (t) => [index("saved_filters_project_id_idx").on(t.projectId)],
);

// In-app bell (NOTIF-4, section 11.8). The type is a shared/notifications.ts event; the payload is the few
// words the bell needs (task key and title, project name), captured when it happened.
export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    actorId: integer("actor_id").references(() => users.id),
    taskId: integer("task_id").references(() => tasks.id),
    payloadJson: text("payload_json").notNull().default("{}"),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (t) => [index("notifications_user_id_read_at_idx").on(t.userId, t.readAt), index("notifications_user_id_created_at_idx").on(t.userId, t.createdAt)],
);

export const EMAIL_STATUSES = ["pending", "sent", "failed", "digested"] as const;
export const EMAIL_MODES = ["instant", "digest"] as const;

// Email (section 8). Rows are written in the same batch as the action that causes them (rule 1); the cron job
// sends instant rows and the 7 am digest gathers digest rows. user_id is null only for invites, where the
// person isn't a user yet and to_email holds the address; otherwise the address is looked up at send time.
export const emailOutbox = sqliteTable(
  "email_outbox",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").references(() => users.id),
    toEmail: text("to_email"),
    template: text("template").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    // Rule 4: stops duplicates even if a job runs twice. Null for one-off events.
    dedupeKey: text("dedupe_key"),
    mode: text("mode", { enum: EMAIL_MODES }).notNull().default("instant"),
    status: text("status", { enum: EMAIL_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    sendAfter: integer("send_after").notNull(),
    sentAt: integer("sent_at"),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (t) => [
    check("email_outbox_status_check", oneOf("status", EMAIL_STATUSES)),
    check("email_outbox_mode_check", oneOf("mode", EMAIL_MODES)),
    index("email_outbox_status_send_after_idx").on(t.status, t.sendAfter),
    index("email_outbox_user_id_status_idx").on(t.userId, t.status),
    uniqueIndex("email_outbox_dedupe_key_idx").on(t.dedupeKey),
    index("email_outbox_sent_at_idx").on(t.sentAt),
  ],
);

// NOTIF-5: per person and event, email instant, in the digest, or off. No row means the event's default.
export const notificationPrefs = sqliteTable(
  "notification_prefs",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    eventType: text("event_type").notNull(),
    channel: text("channel").notNull().default("email"),
    mode: text("mode", { enum: ["instant", "digest", "off"] }).notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventType, t.channel] }), check("notification_prefs_mode_check", oneOf("mode", ["instant", "digest", "off"]))],
);

// What's New (FDBK-1, section 11.9): admin-written Markdown, rendered with raw HTML disabled.
export const releasesNews = sqliteTable(
  "releases_news",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    publishedAt: integer("published_at").notNull(),
    ...timestamps,
  },
  (t) => [index("releases_news_published_at_idx").on(t.publishedAt)],
);

// The newest What's New entry each person has opened; anything newer shows the dot.
export const userNewsSeen = sqliteTable("user_news_seen", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id),
  lastNewsId: integer("last_news_id").notNull(),
  seenAt: integer("seen_at").notNull(),
});

// Section 16: event-history aggregates built hourly and incrementally from task_events. One row per project
// and period: "w:<Monday YYYY-MM-DD>" (created and completed that week) or "m:<YYYY-MM>" (cycle-time samples).
// last_event_id is the newest event folded into the row, so an event is never counted twice. project_id 0
// holds the job's cursor (no foreign key for that reason).
export const reportSnapshots = sqliteTable(
  "report_snapshots",
  {
    projectId: integer("project_id").notNull(),
    period: text("period").notNull(),
    metricsJson: text("metrics_json").notNull().default("{}"),
    lastEventId: integer("last_event_id").notNull().default(0),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.projectId, t.period] })],
);

export const DELETION_STATUSES =["pending", "approved", "rejected", "completed"] as const;

// ADM-6: a person asks for their data to be deleted; an App Admin approves (anonymised at once) or rejects.
export const dataDeletionRequests = sqliteTable(
  "data_deletion_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    requestedAt: integer("requested_at").notNull(),
    status: text("status", { enum: DELETION_STATUSES }).notNull().default("pending"),
    decidedBy: integer("decided_by").references(() => users.id),
    decidedAt: integer("decided_at"),
    ...timestamps,
  },
  (t) => [check("data_deletion_requests_status_check", oneOf("status", DELETION_STATUSES)), index("data_deletion_requests_status_idx").on(t.status, t.requestedAt)],
);

// The "small error table" (section 5): one row per server error or crashed section (11.13), counted by the
// error-spike alert (NFR-15). No personal data: a section name, a request id and a hashed IP only (NFR-5).
export const appErrors = sqliteTable(
  "app_errors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source", { enum: ["server", "client"] }).notNull(),
    section: text("section"),
    requestId: text("request_id").notNull(),
    ipHash: text("ip_hash"),
    at: integer("at").notNull().default(nowMs),
  },
  (t) => [index("app_errors_at_idx").on(t.at)],
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
