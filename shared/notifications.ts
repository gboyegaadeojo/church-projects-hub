import { z } from "zod";

// Notifications: the in-app bell (NOTIF-4, section 11.8) and, from Stage 5b, email (NOTIF-1 to NOTIF-6, section 8).
// One catalogue of events: who gets them, whether they show in the bell, and the default email mode.

export const EMAIL_MODES = ["instant", "digest", "off"] as const;
export type EmailMode = (typeof EMAIL_MODES)[number];

export const NOTIFICATION_EVENTS = {
  "task.assigned": { label: "A task is assigned to me", bell: true, email: "instant" },
  "task.mentioned": { label: "Someone @mentions me", bell: true, email: "instant" },
  "task.commented": { label: "A comment on a task I own or watch", bell: true, email: "digest" },
  "task.status_changed": { label: "A task I reported changes status", bell: true, email: "digest" },
  "task.due_soon": { label: "A task of mine is due in 7 days", bell: false, email: "digest" },
  "task.due_tomorrow": { label: "A task of mine is due tomorrow", bell: false, email: "digest" },
  "task.overdue": { label: "A task of mine is overdue", bell: true, email: "digest" },
  "access.requested": { label: "Someone asks to join a project I run", bell: true, email: "instant" },
  "access.decided": { label: "My access request is decided", bell: true, email: "instant" },
  // AUTH-8: the requester's "Still waiting?" reminder, to the project's deciders.
  "access.nudge": { label: "Someone is still waiting to join a project I run", bell: true, email: "instant" },
  // Section 7: requests still pending after 3 days, once, to every App Admin.
  "access.reminder": { label: "Access requests waiting more than 3 days", bell: false, email: "instant" },
  "feedback.status_changed": { label: "My bug report or idea changes status", bell: true, email: "digest" },
  "project.weekly_summary": { label: "Weekly summary of projects I run", bell: false, email: "off" },
} as const satisfies Record<string, { label: string; bell: boolean; email: EmailMode }>;
export type NotificationType = keyof typeof NOTIFICATION_EVENTS;
export const NOTIFICATION_TYPES = Object.keys(NOTIFICATION_EVENTS) as NotificationType[];

/** Section 11.8: the dropdown shows the 20 newest from the last 30 days; older ones are on the full page. */
export const BELL_LIMIT = 20;
export const BELL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Section 11.8: the bell refreshes every 2 minutes while the tab is visible, and on focus. */
export const BELL_REFRESH_MS = 2 * 60 * 1000;
/** Every authenticated API response carries the unread count (section 11.8). */
export const UNREAD_HEADER = "X-Unread-Count";
/** The badge shows at most "99+". */
export const UNREAD_CAP = 100;

export const NOTIFICATION_COPY = {
  empty: "You're all caught up.",
} as const;

export const notificationPayload = z.object({
  taskKey: z.string().optional(),
  taskTitle: z.string().optional(),
  projectKey: z.string().optional(),
  projectName: z.string().optional(),
  stateName: z.string().optional(),
  decision: z.enum(["approved", "denied"]).optional(),
  /** Section 7: a denial's reason is emailed to the requester. */
  reason: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  requesterName: z.string().optional(),
});
export type NotificationPayload = z.infer<typeof notificationPayload>;

export const notificationItem = z.object({
  id: z.number().int(),
  type: z.enum(NOTIFICATION_TYPES as [NotificationType, ...NotificationType[]]),
  actor: z.object({ id: z.number().int(), name: z.string(), avatarUrl: z.string().nullable() }).nullable(),
  payload: notificationPayload,
  read: z.boolean(),
  createdAt: z.number(),
});
export type NotificationItem = z.infer<typeof notificationItem>;

export const notificationsResponse = z.object({
  items: z.array(notificationItem),
  unread: z.number().int(),
  /** Pass as ?before= for the next page; null at the end. */
  nextBefore: z.number().int().nullable(),
});
export type NotificationsResponse = z.infer<typeof notificationsResponse>;

/** One line for a notification, e.g. "Sam assigned you MEDIA-42: Replace stage left DI box". */
export function describeNotification(n: Pick<NotificationItem, "type" | "actor" | "payload">): string {
  const who = n.actor?.name ?? "Someone";
  const task = n.payload.taskKey ? `${n.payload.taskKey}${n.payload.taskTitle ? `: ${n.payload.taskTitle}` : ""}` : "a task";
  switch (n.type) {
    case "task.assigned":
      return `${who} assigned you ${task}`;
    case "task.mentioned":
      return `${who} mentioned you in ${task}`;
    case "task.commented":
      return `${who} commented on ${task}`;
    case "task.status_changed":
      return `${who} moved ${task} to ${n.payload.stateName ?? "another column"}`;
    case "task.due_soon":
      return `${task} is due in 7 days`;
    case "task.due_tomorrow":
      return `${task} is due tomorrow`;
    case "task.overdue":
      return `${task} is overdue`;
    case "access.requested":
      return `${who} asked to join ${n.payload.projectName ?? "a project"}`;
    case "access.decided":
      return n.payload.decision === "approved"
        ? `You can now use ${n.payload.projectName ?? "the project"}`
        : `Your request to join ${n.payload.projectName ?? "the project"} was declined`;
    case "access.nudge":
      return `${who} is still waiting to join ${n.payload.projectName ?? "a project"}`;
    case "access.reminder":
      return "Access requests are waiting more than 3 days";
    case "feedback.status_changed":
      return `Your feedback ${task} moved to ${n.payload.stateName ?? "a new status"}`;
    case "project.weekly_summary":
      return `Weekly summary for ${n.payload.projectName ?? "your project"}`;
  }
}

/** Where a notification leads. */
export function notificationHref(n: Pick<NotificationItem, "type" | "payload">): string {
  // FDBK-5: submitters can't open Hub Feedback; their own reports are listed on the feedback page.
  if (n.type === "feedback.status_changed") return "/feedback";
  if (n.payload.taskKey && n.payload.projectKey) return `/projects/${n.payload.projectKey}?task=${n.payload.taskKey}`;
  if (n.type === "access.requested" || n.type === "access.nudge" || n.type === "access.reminder") return "/admin/requests";
  if (n.type === "access.decided") return n.payload.decision === "approved" && n.payload.projectKey ? `/projects/${n.payload.projectKey}` : "/request-access";
  return "/notifications";
}

// ---- Email settings (NOTIF-5) and one-click unsubscribe (NOTIF-6)

/** Events a person can set. The weekly summary isn't built yet, so it isn't offered. */
export const SETTABLE_EVENTS = NOTIFICATION_TYPES.filter((t) => t !== "project.weekly_summary");
/** Shown only to people who decide access requests; the 3-day reminder only to App Admins. */
export const DECIDER_EVENTS: readonly NotificationType[] = ["access.requested", "access.nudge"];
export const APP_ADMIN_EVENTS: readonly NotificationType[] = ["access.reminder"];

const notificationType = z.enum(NOTIFICATION_TYPES as [NotificationType, ...NotificationType[]]);
const emailMode = z.enum(EMAIL_MODES);

export const notificationSettingsResponse = z.object({
  timezone: z.string(),
  events: z.array(z.object({ type: notificationType, mode: emailMode, defaultMode: emailMode })),
});
export type NotificationSettings = z.infer<typeof notificationSettingsResponse>;

export const updateNotificationSettingsBody = z
  .object({
    timezone: z.string().min(1).max(64).optional(),
    events: z.partialRecord(notificationType, emailMode).optional(),
  })
  .refine((b) => b.timezone !== undefined || b.events !== undefined);

/** "digest" stands for every event the person gets in the morning digest. */
export const unsubscribeBody = z.object({
  u: z.coerce.number().int().positive(),
  e: z.union([notificationType, z.literal("digest")]),
  t: z.string().min(10).max(100),
});

export const UNSUBSCRIBE_COPY = {
  done: "You're unsubscribed.",
  invalid: "This unsubscribe link isn't valid. You can change your email settings after signing in.",
} as const;
