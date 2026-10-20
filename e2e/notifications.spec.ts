import { expect } from "@playwright/test";
import { NOTIFICATION_COPY, UNSUBSCRIBE_COPY } from "../shared/notifications";
import { expectNoViolations } from "./support/axe";
import { DETAIL_PROJECTS, persona } from "./support/fixtures";
import { test, viewportOf } from "./support/pageAs";

// NOTIF-4 / section 11.8: the bell, its badge and dropdown, and the full page.

test("NOTIF-4 the bell shows an assignment, links to the task, and marks read", async ({ pageAs }, testInfo) => {
  const v = viewportOf(testInfo);
  const project = DETAIL_PROJECTS[v];
  const me = persona("mover", v);
  const page = await pageAs(me);
  await page.goto("/work");
  const bellButton = page.getByRole("button", { name: /^Notifications/ }).first();
  await expect(bellButton).toBeVisible();

  // An App Admin assigns one of the board's tasks to this person.
  const admin = await pageAs(persona("admin"));
  await admin.goto("/work");
  await admin.evaluate(
    async ({ key, userId }) => {
      const csrf = (await (await fetch("/api/auth/me")).json()).csrfToken;
      const { task } = await (await fetch(`/api/tasks/by-key/${key}`)).json();
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ version: task.version, assigneeId: userId }),
      });
    },
    { key: `${project.key}-1`, userId: me.id },
  );

  // The badge updates on focus or the next API response; a reload is the quickest.
  await page.reload();
  await expect(bellButton).toHaveAccessibleName(/Notifications, \d+ unread/);
  await bellButton.click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  const item = panel.getByRole("button", { name: new RegExp(`Grace Admin assigned you ${project.key}-1`) });
  await expect(item).toBeVisible();
  await expect(item).toContainText("Unread");
  await expectNoViolations(page, "[role=dialog]");
  await item.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.key}\\?task=${project.key}-1`));
  await page.keyboard.press("Escape");

  // Opening it marked it read: the full page shows it without the unread marker, and nothing is left to mark.
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
  const row = page.getByRole("main").getByRole("button", { name: new RegExp(`assigned you ${project.key}-1`) }).first();
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("Unread");
  await expect(page.getByRole("main").getByRole("button", { name: "Mark all as read" })).toBeDisabled();
  await expectNoViolations(page);
});

test("NOTIF-4 empty state", async ({ pageAs }) => {
  const page = await pageAs(persona("loner"));
  await page.goto("/work");
  await page.getByRole("button", { name: /^Notifications/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Notifications" }).getByText(NOTIFICATION_COPY.empty)).toBeVisible();
});

test("NOTIF-5 email settings save and stay saved", async ({ pageAs }, testInfo) => {
  const page = await pageAs(persona("themer", viewportOf(testInfo)));
  await page.goto("/settings/notifications");
  await expect(page.getByRole("heading", { level: 1, name: "Email settings" })).toBeVisible();
  const comments = page.getByRole("combobox", { name: "A comment on a task I own or watch" });
  await expect(comments).toHaveText("In the 7 am digest");
  await expectNoViolations(page);
  await comments.click();
  await page.getByRole("option", { name: "Off" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "A comment on a task I own or watch" })).toHaveText("Off");
  await expect(page.getByText("Usually in the 7 am digest")).toBeVisible();
  // Access-request emails are only offered to people who decide requests.
  await expect(page.getByRole("combobox", { name: "Someone asks to join a project I run" })).toHaveCount(0);
});

test("NOTIF-6 an unsubscribe link that isn't valid says so, without signing in", async ({ page }) => {
  await page.goto("/unsubscribe?u=1&e=task.assigned&t=not-a-real-token");
  await expect(page.getByRole("heading", { level: 1, name: /Unsubscribe from/ })).toBeVisible();
  await expectNoViolations(page);
  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(page.getByRole("alert")).toHaveText(UNSUBSCRIBE_COPY.invalid);
});
