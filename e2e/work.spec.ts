import { expect } from "@playwright/test";
import { expectNoViolations } from "./support/axe";
import { BOARD_PROJECTS, BOARD_TASKS, DETAIL_PROJECTS, persona } from "./support/fixtures";
import { test, viewportOf } from "./support/pageAs";

// Stage 3f: My Work (NAV-3, section 11.1) and global search (NAV-1, section 11.11).

test("NAV-1 search finds tasks by words and jumps to a key", async ({ pageAs }, testInfo) => {
  const v = viewportOf(testInfo);
  const project = BOARD_PROJECTS[v];
  const page = await pageAs(persona("mover", v));
  await page.goto("/work");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Search" }).click();
  const box = page.getByRole("searchbox", { name: "Search tasks and projects" });
  await box.fill("encod");
  // The same title is in this person's board and detail projects; check the board's one.
  const result = page.getByRole("link", { name: new RegExp(`${project.key}-2.*${BOARD_TASKS[1].title}`) });
  await expect(result).toBeVisible();
  await expect(page).toHaveURL(/q=encod/);
  await expectNoViolations(page);

  await box.fill(`${project.key}-2`);
  await expect(page.getByRole("heading", { name: `Go to ${project.key}-2` })).toBeVisible();
  await box.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/projects/${project.key}\\?task=${project.key}-2`));
  await expect(page.getByRole("dialog", { name: `${project.key}-2` })).toBeVisible();
});

test("NAV-3 My Work lists my assigned tasks by when they're due", async ({ pageAs }, testInfo) => {
  const v = viewportOf(testInfo);
  // The detail project's task 2 stays in To Do (the board tests move the board's one to Done).
  const project = DETAIL_PROJECTS[v];
  const me = persona("mover", v);
  const page = await pageAs(me);
  await page.goto("/work");
  // Assign a board task to me, due long ago, through the API.
  await page.evaluate(
    async ({ key, userId }) => {
      const csrf = (await (await fetch("/api/auth/me")).json()).csrfToken;
      const { task } = await (await fetch(`/api/tasks/by-key/${key}`)).json();
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ version: task.version, assigneeId: userId, dueDate: "2026-01-04" }),
      });
    },
    { key: `${project.key}-2`, userId: me.id },
  );
  await page.reload();
  const overdue = page.getByRole("region", { name: /Overdue/ });
  await expect(overdue.getByRole("link", { name: new RegExp(BOARD_TASKS[1].title) })).toBeVisible();
  await expectNoViolations(page);
});
