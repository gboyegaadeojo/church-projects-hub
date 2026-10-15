import { z } from "zod";
import { projectRole } from "./access";

// Projects and the profile — contract shared by the Worker and the app (PROJ-1, PROJ-6, PROJ-7, section 9).

/** Project colours (section 9 "project accent"). Stored by name; each maps to a --project-<name> token per theme. */
export const PROJECT_COLOURS = ["blue", "teal", "green", "amber", "orange", "red", "pink", "purple"] as const;
export type ProjectColour = (typeof PROJECT_COLOURS)[number];

/** Project icons: Lucide names (section 9: one icon family). The app maps each name to its component. */
export const PROJECT_ICONS = [
  "folder",
  "video",
  "music",
  "mic",
  "monitor",
  "camera",
  "baby",
  "coffee",
  "utensils",
  "wrench",
  "heart-handshake",
  "megaphone",
  "book-open",
  "users",
  "calendar",
  "message-square",
] as const;
export type ProjectIcon = (typeof PROJECT_ICONS)[number];

export const PROJECT_NAME_MAX = 60;
export const PROJECT_DESCRIPTION_MAX = 500;

/** The built-in Hub Feedback project (PROJ-7). Its key is reserved so a team project can never take it. */
export const HUB_FEEDBACK = {
  key: "HUB",
  name: "Hub Feedback",
  description: "Bug reports and feature requests sent from inside the hub.",
  colour: "purple",
  icon: "message-square",
} as const satisfies { key: string; name: string; description: string; colour: ProjectColour; icon: ProjectIcon };

/** Default workflow columns for every new project (PROJ-2, section 18). */
export const DEFAULT_WORKFLOW = [
  { name: "Backlog", category: "todo" },
  { name: "To Do", category: "todo" },
  { name: "In Progress", category: "in_progress" },
  { name: "In Review", category: "in_progress" },
  { name: "Done", category: "done" },
] as const;

export const PROJECT_ERRORS = { keyTaken: "key_taken", system: "system_project" } as const;

export const PROJECT_COPY = {
  keyTaken: "Another project already uses that key. Choose a different one.",
  created: "Project created.",
  saved: "Saved.",
} as const;

/** 2 to 10 capital letters or digits, starting with a letter (task keys look like MEDIA-42). */
export const projectKey = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, "Use 2 to 10 letters or numbers, starting with a letter, like MEDIA.")
  .refine((key) => key !== HUB_FEEDBACK.key, "That key is reserved for Hub Feedback. Choose a different one.");

const projectFields = {
  name: z
    .string()
    .trim()
    .min(1, "Enter a name for the project.")
    .max(PROJECT_NAME_MAX, `Keep the name under ${PROJECT_NAME_MAX} characters.`),
  description: z
    .string()
    .trim()
    .max(PROJECT_DESCRIPTION_MAX, `Keep the description under ${PROJECT_DESCRIPTION_MAX} characters.`),
  colour: z.enum(PROJECT_COLOURS, "Choose a colour."),
  icon: z.enum(PROJECT_ICONS, "Choose an icon."),
  hidden: z.boolean(),
};

/** PROJ-1 (App Admin): name, short key, colour, icon and description; PROJ-6 hidden flag. */
export const createProjectBody = z.object({
  ...projectFields,
  key: projectKey,
  description: projectFields.description.default(""),
  hidden: projectFields.hidden.default(false),
});
export type CreateProjectBody = z.input<typeof createProjectBody>;

/** Edits by an App Admin. The key never changes: task keys are built from it. */
export const updateProjectBody = z
  .object(projectFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to change.");
export type UpdateProjectBody = z.input<typeof updateProjectBody>;

export const projectSummary = z.object({
  id: z.number().int(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  colour: z.enum(PROJECT_COLOURS),
  icon: z.enum(PROJECT_ICONS),
  hidden: z.boolean(),
  /** Hub Feedback (PROJ-7). */
  isSystem: z.boolean(),
  archived: z.boolean(),
  /** The signed-in person's role here; null for App Admins who aren't members. */
  role: projectRole.nullable(),
});
export type ProjectSummary = z.infer<typeof projectSummary>;
export const projectListResponse = z.object({ projects: z.array(projectSummary) });
export const projectResponse = z.object({ project: projectSummary });

// ---- Profile

export const updatePreferencesBody = z.object({ theme: z.enum(["light", "dark", "system"]) });
