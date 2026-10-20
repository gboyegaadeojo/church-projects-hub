import { z } from "zod";

// What's New (FDBK-1, section 11.9) and Report a Bug / Request a Feature (FDBK-2 to FDBK-5, RATE-3).

export const NEWS_TITLE_MAX = 120;
export const NEWS_BODY_MAX = 10_000;

export const newsItem = z.object({
  id: z.number().int(),
  title: z.string(),
  bodyMd: z.string(),
  publishedAt: z.number(),
  updatedAt: z.number(),
});
export type NewsItem = z.infer<typeof newsItem>;

export const newsResponse = z.object({ items: z.array(newsItem), canPublish: z.boolean() });
export const newsUnreadResponse = z.object({ unread: z.boolean() });

export const newsBody = z.object({
  title: z.string().trim().min(1).max(NEWS_TITLE_MAX),
  bodyMd: z.string().trim().min(1).max(NEWS_BODY_MAX),
});
export type NewsBody = z.infer<typeof newsBody>;

/** RATE-3 / NFR-4: 20 feedback submissions per person per calendar day in their timezone. */
export const FEEDBACK_DAILY_LIMIT = 20;
export const FEEDBACK_TEXT_MAX = 4000;
/** The screenshot must follow its report within this time, from the same person. */
export const SCREENSHOT_WINDOW_MS = 10 * 60 * 1000;

const text = (max: number) => z.string().trim().min(1).max(max);

export const bugReportBody = z.object({
  whatHappened: text(FEEDBACK_TEXT_MAX),
  expected: text(FEEDBACK_TEXT_MAX),
  /** Captured automatically by the form (FDBK-2). */
  page: z.string().trim().max(500).default(""),
  browser: z.string().trim().max(500).default(""),
});
export type BugReportBody = z.input<typeof bugReportBody>;

export const featureRequestBody = z.object({
  title: text(120),
  description: text(FEEDBACK_TEXT_MAX),
  why: text(FEEDBACK_TEXT_MAX),
});
export type FeatureRequestBody = z.input<typeof featureRequestBody>;

export const feedbackCreated = z.object({ id: z.number().int(), key: z.string() });

export const myFeedbackItem = z.object({
  id: z.number().int(),
  key: z.string(),
  title: z.string(),
  kind: z.enum(["bug", "idea"]),
  status: z.string(),
  done: z.boolean(),
  createdAt: z.number(),
});
export type MyFeedbackItem = z.infer<typeof myFeedbackItem>;
export const myFeedbackResponse = z.object({ items: z.array(myFeedbackItem) });

export const FEEDBACK_ERRORS = { rateLimited: "feedback_rate_limited", unavailable: "feedback_unavailable" } as const;

export const FEEDBACK_COPY = {
  rateLimited: "You've sent a lot of feedback today — thank you! You can submit more tomorrow.",
  newsEmpty: "Nothing new yet. Check back after the next update.",
  bugSent: "Thanks — your bug report was sent.",
  featureSent: "Thanks — your idea was sent.",
} as const;
