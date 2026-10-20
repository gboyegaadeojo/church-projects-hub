import { expect, type Page } from "@playwright/test";
import { TASK_COPY } from "../shared/tasks";
import { expectNoViolations } from "./support/axe";
import { DETAIL_PROJECTS, BOARD_TASKS, persona } from "./support/fixtures";
import { test, viewportOf } from "./support/pageAs";

// Stage 3c: task detail (section 11.3), inline editing, subtasks (TASK-3), comments (TASK-4), history (TASK-6),
// conflicts (NFR-10). Uses its own project per viewport; the tests build on each other, so they run in order.
test.describe.configure({ mode: "serial" });

const sheet = (page: Page, key: string) => page.getByRole("dialog", { name: key });

/** Changes a task straight through the API, as someone else would. */
async function changeElsewhere(page: Page, taskKey: string, body: Record<string, unknown>) {
  await page.evaluate(
    async ({ taskKey, body }) => {
      const me = await (await fetch("/api/auth/me")).json();
      const { task } = await (await fetch(`/api/tasks/by-key/${taskKey}`)).json();
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify({ version: task.version, ...body }),
      });
    },
    { taskKey, body },
  );
}

test.describe("Section 11.3 task detail", () => {
  test("opens from the board, edits inline with Saved ✓, and closes back to the board", async ({ pageAs }, testInfo) => {
    const v = viewportOf(testInfo);
    const project = DETAIL_PROJECTS[v];
    const key = `${project.key}-1`;
    const page = await pageAs(persona("mover", v));
    await page.goto(`/projects/${project.key}`);
    await page.getByRole("button", { name: BOARD_TASKS[0].title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`task=${key}`));
    const detail = sheet(page, key);
    await expect(detail.getByLabel("Title")).toHaveValue(BOARD_TASKS[0].title);
    await expectNoViolations(page, "[role=dialog]");

    await detail.getByLabel("Title").fill("Replace mic batteries before Sunday");
    await detail.getByLabel("Title").press("Enter");
    await expect(detail.getByText(TASK_COPY.saved)).toBeVisible();

    await detail.getByRole("combobox", { name: "Priority" }).click();
    await page.getByRole("option", { name: "Urgent" }).click();
    await expect(detail.getByText(TASK_COPY.saved)).toBeVisible();
    await expect(detail.getByText("changed priority from High to Urgent")).toBeVisible();

    if (v === "mobile") await detail.getByRole("button", { name: "Back to board" }).click();
    else await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
    await expect(page).not.toHaveURL(/task=/);
    await expect(page.getByRole("button", { name: "Replace mic batteries before Sunday", exact: true })).toBeAttached();
  });

  test("checklist items and comments (TASK-3, TASK-4)", async ({ pageAs }, testInfo) => {
    const v = viewportOf(testInfo);
    const project = DETAIL_PROJECTS[v];
    const key = `${project.key}-2`;
    const page = await pageAs(persona("mover", v));
    await page.goto(`/projects/${project.key}?task=${key}`);
    const detail = sheet(page, key);
    await detail.getByLabel("New checklist item").fill("Check the backup encoder");
    await detail.getByRole("button", { name: "Add", exact: true }).click();
    await detail.getByRole("checkbox", { name: "Check the backup encoder" }).click();
    await expect(detail.getByText("1 of 1 done")).toBeVisible();

    await detail.getByLabel("Add a comment").fill("Encoder firmware updated.");
    await detail.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(detail.getByText("Encoder firmware updated.")).toBeVisible();
    await expect(detail.getByText("Mover", { exact: false }).first()).toBeVisible();
    await expectNoViolations(page, "[role=dialog]");
  });

  test("NFR-10 a conflicting change shows the conflict message and the latest version", async ({ pageAs }, testInfo) => {
    const v = viewportOf(testInfo);
    const project = DETAIL_PROJECTS[v];
    const key = `${project.key}-3`;
    const page = await pageAs(persona("mover", v));
    await page.goto(`/projects/${project.key}?task=${key}`);
    const detail = sheet(page, key);
    await expect(detail.getByLabel("Title")).toHaveValue(BOARD_TASKS[2].title);

    const other = await pageAs(persona("mover", v));
    await other.goto("/work");
    await changeElsewhere(other, key, { title: "Print slide notes in large type" });

    await detail.getByRole("combobox", { name: "Scope" }).click();
    await page.getByRole("option", { name: "Parked" }).click();
    await expect(detail.getByRole("alert").filter({ hasText: TASK_COPY.conflict })).toBeVisible();
    // The latest version is on screen to review.
    await expect(detail.getByLabel("Title")).toHaveValue("Print slide notes in large type");
    await detail.getByRole("button", { name: "Save mine over theirs" }).click();
    await expect(detail.getByText(TASK_COPY.saved)).toBeVisible();
    await expect(detail.getByRole("combobox", { name: "Scope" })).toContainText("Parked");
  });
});
