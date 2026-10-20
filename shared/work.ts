import { z } from "zod";
import { PROJECT_COLOURS, PROJECT_ICONS } from "./projects";
import { PRIORITIES, TASK_TYPES } from "./tasks";

// My Work (NAV-3, section 11.1) and global search (NAV-1, section 11.11).

export const WORK_COPY = {
  allCaughtUp: "You're all caught up. Check the board for work you can pick up.",
} as const;

const projectRef = z.object({
  key: z.string(),
  name: z.string(),
  colour: z.enum(PROJECT_COLOURS),
  icon: z.enum(PROJECT_ICONS),
});

export const workTask = z.object({
  id: z.number().int(),
  key: z.string(),
  title: z.string(),
  type: z.enum(TASK_TYPES),
  priority: z.enum(PRIORITIES),
  dueDate: z.string().nullable(),
  stateName: z.string(),
  project: projectRef,
});
export type WorkTask = z.infer<typeof workTask>;

export const workMention = z.object({
  id: z.number().int(),
  taskKey: z.string(),
  taskTitle: z.string(),
  projectKey: z.string(),
  by: z.string(),
  at: z.number(),
  inComment: z.boolean(),
});
export type WorkMention = z.infer<typeof workMention>;

export const workResponse = z.object({
  /** Open tasks assigned to me (not in a Done column), across my projects. */
  tasks: z.array(workTask),
  /** Unread @mentions, newest first. */
  mentions: z.array(workMention),
});
export type WorkResponse = z.infer<typeof workResponse>;

/** Section 11.11: results after 2 characters, debounced 200 ms. */
export const SEARCH_MIN_CHARS = 2;
export const SEARCH_DEBOUNCE_MS = 200;
export const SEARCH_MAX_QUERY = 100;

export const searchTaskResult = workTask.extend({ snippet: z.string() });
export type SearchTaskResult = z.infer<typeof searchTaskResult>;

export const searchResponse = z.object({
  /** A query that looks like a key (MEDIA-42) and names a task the person can see. */
  exact: workTask.nullable(),
  tasks: z.array(searchTaskResult),
  projects: z.array(projectRef),
});
export type SearchResponse = z.infer<typeof searchResponse>;

/**
 * Turns what someone typed into a safe FTS5 query: words only, each a prefix match, all required.
 * Returns null when nothing searchable is left.
 */
export function ftsQuery(input: string): string | null {
  const words = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  if (words.length === 0) return null;
  return words.map((w) => `"${w}"*`).join(" ");
}
