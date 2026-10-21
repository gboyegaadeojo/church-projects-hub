import { expect, type Page } from "@playwright/test";
import { AUTH_COPY } from "../shared/auth";
import { TASK_COPY } from "../shared/tasks";
import { expectNoViolations } from "./support/axe";
import { ARCHIVE_PROJECTS, JOURNEY_PROJECTS, persona } from "./support/fixtures";
import { test, viewportOf } from "./support/pageAs";

// Stage 8: the end-to-end journeys in section 17 that other files only cover in pieces.
// Each viewport has its own projects and people, so desktop and mobile runs never collide.

const column = (page: Page, name: string) => page.getByRole("region", { name: "Board" }).getByRole("region", { name });

test("Section 17 create a task → assign → move on the board → task detail → comment with an @mention → delete", async ({ pageAs }, testInfo) => {
  const v = viewportOf(testInfo);
  const project = JOURNEY_PROJECTS[v];
  const me = persona("mover", v);
  const key = `${project.key}-1`;
  const title = "Set up the welcome table";
  const page = await pageAs(me);
  await page.goto(`/projects/${project.key}`);

  // Create, assigned to me, in To Do.
  await page.getByRole("button", { name: "New task" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "To Do" }).click();
  await dialog.getByRole("combobox", { name: /^Assignee/ }).click();
  await page.getByRole("option", { name: me.name }).click();
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText(`${key} created.`).first()).toBeVisible();
  const detail = page.getByRole("dialog", { name: key });
  await expect(detail).toBeVisible();
  if (v === "mobile") await detail.getByRole("button", { name: "Back to board" }).click();
  else await page.keyboard.press("Escape");

  // Move it with the keyboard-friendly Move button (drag and drop has its own test in board.spec.ts).
  const card = column(page, "To Do").getByRole("listitem").filter({ hasText: title });
  await expect(card.getByText(`Assigned to ${me.name}`)).toBeAttached();
  await card.getByRole("button", { name: `Move ${key}` }).click();
  await page.getByRole("menuitem", { name: "In Progress" }).click();
  const moved = column(page, "In Progress").getByRole("button", { name: title, exact: true });
  await expect(moved).toBeAttached();
  await page.reload();
  await expect(moved).toBeAttached();

  // Open it from the board and comment, mentioning someone.
  await moved.click();
  await expect(detail).toBeVisible();
  const comment = detail.getByRole("textbox", { name: "Add a comment" });
  await comment.click();
  await page.keyboard.type("Ready for Sunday @Mov");
  await expect(page.getByRole("listbox", { name: "People to mention" }).getByRole("option", { name: me.name })).toBeVisible();
  await page.keyboard.press("Enter");
  await detail.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(detail.getByText(`@${me.name}`).last()).toBeVisible();
  await expectNoViolations(page, "[role=dialog]");

  // Section 11.14: Cancel leaves the task; confirming removes it.
  await detail.getByRole("button", { name: "Delete task" }).click();
  const confirm = page.getByRole("alertdialog", { name: `Delete ${key}?` });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "Delete task" }).click();
  await confirm.getByRole("button", { name: "Delete task" }).click();
  await expect(page.getByText(TASK_COPY.deleted).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Board" }).getByRole("button", { name: title, exact: true })).toHaveCount(0);
});

test("Section 11.14 archiving a project needs its key typed first", async ({ pageAs }, testInfo) => {
  const project = ARCHIVE_PROJECTS[viewportOf(testInfo)];
  const page = await pageAs(persona("admin"));
  await page.goto("/admin/projects");
  const row = page.getByRole("row").filter({ hasText: project.name });
  await row.getByRole("button", { name: `Archive ${project.name}` }).click();
  const confirm = page.getByRole("alertdialog", { name: `Archive ${project.name}?` });
  const archive = confirm.getByRole("button", { name: "Archive project" });
  await expect(archive).toBeDisabled();
  await confirm.getByRole("textbox", { name: `Type ${project.key} to confirm.` }).fill("wrong");
  await expect(archive).toBeDisabled();
  // Case and surrounding spaces don't matter.
  await confirm.getByRole("textbox", { name: `Type ${project.key} to confirm.` }).fill(` ${project.key.toLowerCase()} `);
  await archive.click();
  await expect(row.getByText("Archived")).toBeVisible();
  await expect(row.getByRole("button", { name: `Restore ${project.name}` })).toBeVisible();
});

test("AUTH-7 signing someone out everywhere ends their session with the section 11.7 message", async ({ pageAs }, testInfo) => {
  const target = persona("revokee", viewportOf(testInfo));
  const victim = await pageAs(target);
  await victim.goto("/work");
  await expect(victim.getByRole("heading", { level: 1, name: "My Work" })).toBeVisible();

  const admin = await pageAs(persona("admin"));
  await admin.goto("/admin/users");
  await admin.getByRole("searchbox", { name: "Search by name or email" }).fill(target.email);
  await admin.getByRole("button", { name: `Manage ${target.name}` }).click();
  await admin.getByRole("dialog", { name: target.name }).getByRole("button", { name: "Sign out everywhere" }).click();
  await admin.getByRole("alertdialog").getByRole("button", { name: "Sign out everywhere" }).click();

  // Their next request is refused, and they land on sign-in with the one-line explanation.
  await victim.reload();
  await expect(victim.getByText(AUTH_COPY.sessionEnded)).toBeVisible();
  await expect(victim.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(victim.getByRole("navigation", { name: "Main" })).toHaveCount(0);
});
