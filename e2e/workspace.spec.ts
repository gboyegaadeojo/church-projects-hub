import { expect, type Page } from "@playwright/test";
import { expectNoViolations } from "./support/axe";
import { persona, WORKSPACE_PROJECTS } from "./support/fixtures";
import { test, viewportOf } from "./support/pageAs";

// v4.6: per-project settings (PROJ-3, ORG-1), the Backlog and Epics views (section 11.16, ORG-3) and the board
// toolbar's search (section 11.2). Each viewport has its own project; the tests build on each other, so they run in order.
test.describe.configure({ mode: "serial" });

/** The task detail that opens after creating a task: wait for it, then close it as a person would. */
async function closeDetail(page: Page, key: string) {
  const detail = page.getByRole("dialog", { name: key });
  await expect(detail).toBeVisible();
  if (page.viewportSize()!.width < 768) await detail.getByRole("button", { name: "Back to board" }).click();
  else await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
}

test("ORG-1 / PROJ-3 an admin manages labels and columns in the project's Settings tab", async ({ pageAs }, testInfo) => {
  const project = WORKSPACE_PROJECTS[viewportOf(testInfo)];
  const page = await pageAs(persona("admin"));
  await page.goto(`/projects/${project.key}/settings`);
  await expect(page.getByRole("heading", { name: "Workflow columns" })).toBeVisible();

  await page.getByRole("button", { name: "New label" }).click();
  await page.getByLabel("Label name").fill("Sunday");
  await page.getByRole("radio", { name: "Green" }).click();
  await page.getByRole("button", { name: "Add label" }).click();
  const labels = page.getByRole("region", { name: "Labels" });
  await expect(labels.getByText("Sunday", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit In Review" }).click();
  await page.getByLabel("Column name").fill("Checking");
  await page.getByRole("button", { name: "Save column" }).click();
  await expect(page.getByRole("region", { name: "Workflow columns" }).getByText("Checking", { exact: true })).toBeVisible();
  await expectNoViolations(page);
});

test("Section 11.16 Backlog: add a task to a section, move it to the top and to another column", async ({ pageAs }, testInfo) => {
  const project = WORKSPACE_PROJECTS[viewportOf(testInfo)];
  const page = await pageAs(persona("admin"));
  await page.goto(`/projects/${project.key}?view=backlog`);
  // The project starts empty, so the first task comes from New task; then the backlog's quick add.
  await page.getByRole("button", { name: "New task" }).first().click();
  await page.getByRole("dialog", { name: "New task" }).getByLabel("Title").fill("Print welcome cards");
  await page.getByRole("button", { name: "Create task" }).click();
  // Creating opens the new task; close it to get back to the backlog.
  await closeDetail(page, `${project.key}-1`);

  const backlog = page.getByRole("region", { name: "Backlog" });
  await backlog.getByRole("textbox", { name: "New task in Backlog" }).fill("Order lanyards");
  await backlog.getByRole("button", { name: "Add", exact: true }).click();
  const rows = backlog.getByRole("listitem");
  await expect(rows.nth(1)).toContainText("Order lanyards");

  await rows.nth(1).getByRole("button", { name: /^Move / }).click();
  await page.getByRole("menuitem", { name: "Move to top" }).click();
  await expect(rows.first()).toContainText("Order lanyards");

  await rows.first().getByRole("button", { name: /^Move / }).click();
  await page.getByRole("menuitem", { name: "To Do", exact: true }).click();
  await expect(page.getByRole("region", { name: "To Do" }).getByText("Order lanyards")).toBeVisible();
  await expectNoViolations(page);
});

test("ORG-3 Epics: create an epic, put a task in it, and see its progress", async ({ pageAs }, testInfo) => {
  const project = WORKSPACE_PROJECTS[viewportOf(testInfo)];
  const page = await pageAs(persona("admin"));
  await page.goto(`/projects/${project.key}?view=epics`);
  await page.getByRole("button", { name: "New epic" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New epic" });
  await dialog.getByLabel("Title").fill("Christmas Eve services");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await closeDetail(page, `${project.key}-3`);

  // Put the backlog's first task into the epic from its detail.
  await page.goto(`/projects/${project.key}?task=${project.key}-1`);
  const detail = page.getByRole("dialog", { name: `${project.key}-1` });
  await detail.getByRole("combobox", { name: "Epic" }).click();
  await page.getByRole("option", { name: /Christmas Eve services/ }).click();
  await expect(detail.getByText("Saved ✓")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto(`/projects/${project.key}?view=epics`);
  const card = page.getByRole("listitem").filter({ hasText: "Christmas Eve services" });
  await expect(card.getByText("0 of 1 task")).toBeVisible();
  await card.getByRole("button", { name: "Tasks" }).click();
  await expect(card.getByText("Print welcome cards")).toBeVisible();
  await expectNoViolations(page);
});

test("Section 11.2 the toolbar's search narrows the board and shows as a removable filter", async ({ pageAs }, testInfo) => {
  const project = WORKSPACE_PROJECTS[viewportOf(testInfo)];
  const page = await pageAs(persona("admin"));
  await page.goto(`/projects/${project.key}`);
  const board = page.getByRole("region", { name: "Board" });
  await expect(board.getByRole("button", { name: "Print welcome cards", exact: true })).toBeAttached();
  await page.getByRole("searchbox", { name: "Search this project's tasks" }).fill("lanyards");
  await expect(board.getByRole("button", { name: "Print welcome cards", exact: true })).toHaveCount(0);
  await expect(board.getByRole("button", { name: "Order lanyards", exact: true })).toBeAttached();
  await expect(page).toHaveURL(/q=lanyards/);
  await page.getByRole("button", { name: "Remove “lanyards”" }).click();
  await expect(board.getByRole("button", { name: "Print welcome cards", exact: true })).toBeAttached();
  await expectNoViolations(page);
});
