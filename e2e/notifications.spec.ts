import { expect } from "@playwright/test";
import { NOTIFICATION_COPY } from "../shared/notifications";
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
