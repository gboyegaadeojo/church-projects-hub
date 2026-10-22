import { expect, type Page } from "@playwright/test";
import { TASK_COPY } from "../shared/tasks";
import { expectNoViolations } from "./support/axe";
import { BOARD_LABEL, BOARD_PROJECTS, BOARD_TASKS, persona } from "./support/fixtures";
import { test, viewportOf } from "./support/pageAs";

// Stage 3b: the board and list (TASK-2, TASK-10, TASK-12, ORG-5, section 11.2, NFR-12, NFR-13).
// Each viewport has its own board project; the tests in this file change it, so they run in order.
test.describe.configure({ mode: "serial" });

const column = (page: Page, name: string) => page.getByRole("region", { name: "Board" }).getByRole("region", { name });
const card = (page: Page, title: string) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: title, exact: true }) });

test.describe("TASK-2 board", () => {
  test("columns show their counts and cards show key, priority and labels", async ({ pageAs }, testInfo) => {
    const v = viewportOf(testInfo);
    const project = BOARD_PROJECTS[v];
    const page = await pageAs(persona("mover", v));
    await page.goto(`/projects/${project.key}`);
    await expect(page.getByRole("heading", { level: 1, name: project.name })).toBeVisible();
    // The header count matches the cards in the column (a retry may run after other tests moved cards).
    const toDo = column(page, "To Do");
    await expect(toDo.getByRole("listitem").first()).toBeVisible();
    const cards = await toDo.getByRole("listitem").count();
    await expect(toDo.getByRole("heading", { level: 2 })).toContainText(cards === 1 ? "1 task" : `${cards} tasks`);
    const first = card(page, BOARD_TASKS[0].title);
    await expect(first).toContainText(`${project.key}-1`);
    await expect(first.getByRole("img", { name: "Priority: High" })).toBeVisible();
    await expect(first.getByText(BOARD_LABEL)).toBeVisible();
    await expectNoViolations(page);
  });

  test("the Move button moves a card without dragging, and it stays moved", async ({ pageAs }, testInfo) => {
    const v = viewportOf(testInfo);
    const project = BOARD_PROJECTS[v];
    const page = await pageAs(persona("mover", v));
    await page.goto(`/projects/${project.key}`);
    const title = BOARD_TASKS[2].title;
    await page.getByRole("button", { name: `Move ${project.key}-3` }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectNoViolations(page, "[role=menu]");
    await page.getByRole("menuitem", { name: "In Progress" }).click();
    await expect(card(page, title)).toBeVisible();
    await expect(column(page, "In Progress").getByRole("button", { name: title, exact: true })).toBeAttached();
    await page.reload();
    await expect(column(page, "In Progress").getByRole("button", { name: title, exact: true })).toBeAttached();
  });

  test("drag and drop moves a card to another column (desktop)", async ({ pageAs }, testInfo) => {
    test.skip(viewportOf(testInfo) !== "desktop", "Pointer drag on desktop; phones use the Move button or press-and-hold.");
    const project = BOARD_PROJECTS.desktop;
    const page = await pageAs(persona("mover", "desktop"));
    await page.goto(`/projects/${project.key}`);
    const title = BOARD_TASKS[1].title;
    const source = card(page, title);
    const target = column(page, "Done").getByRole("list");
    const from = (await source.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + 20);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 30, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + 30, { steps: 15 });
    await page.mouse.up();
    await expect(column(page, "Done").getByRole("button", { name: title, exact: true })).toBeAttached();
    await page.reload();
    await expect(column(page, "Done").getByRole("button", { name: title, exact: true })).toBeAttached();
  });

  test("a refused move puts the card back with the section 14 message (NFR-12)", async ({ pageAs }, testInfo) => {
    const v = viewportOf(testInfo);
    const project = BOARD_PROJECTS[v];
    const page = await pageAs(persona("mover", v));
    await page.route("**/api/tasks/*/move", (route) => route.fulfill({ status: 500, body: "{}" }));
    await page.goto(`/projects/${project.key}`);
    const title = BOARD_TASKS[0].title;
    await page.getByRole("button", { name: `Move ${project.key}-1` }).click();
    await page.getByRole("menuitem", { name: "In Review" }).click();
    // .first(): the toast text is also in Radix's screen-reader announcement.
    await expect(page.getByText(TASK_COPY.moveFailed).first()).toBeVisible();
    await expect(column(page, "To Do").getByRole("button", { name: title, exact: true })).toBeAttached();
  });

  test("the Filter panel narrows the board, lives in the URL, shows as chips and clears", async ({ pageAs }, testInfo) => {
    const v = viewportOf(testInfo);
    const project = BOARD_PROJECTS[v];
    const page = await pageAs(persona("mover", v));
    await page.goto(`/projects/${project.key}`);
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Filter tasks" });
    // Each value says how many tasks it would show.
    const high = panel.getByRole("button", { name: /^Priority: High/ });
    await expect(high).toContainText("1");
    await high.click();
    await expect(high).toHaveAttribute("aria-pressed", "true");
    await expectNoViolations(page, "[role=dialog]");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/priority=high/);
    await expect(page.getByRole("button", { name: BOARD_TASKS[0].title, exact: true })).toBeAttached();
    await expect(page.getByRole("button", { name: BOARD_TASKS[2].title, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Filter\s*1 on$/ })).toBeVisible();
    await expect(page.getByRole("list", { name: "Active filters" }).getByRole("button", { name: "Remove Priority: High" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByRole("button", { name: BOARD_TASKS[2].title, exact: true })).toBeAttached();
  });

  test("New task creates a card in the chosen column", async ({ pageAs }, testInfo) => {
    const v = viewportOf(testInfo);
    const project = BOARD_PROJECTS[v];
    const page = await pageAs(persona("mover", v));
    await page.goto(`/projects/${project.key}`);
    await page.getByRole("button", { name: "New task" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New task" });
    await dialog.getByRole("button", { name: "Create task" }).click();
    await expect(dialog.getByText("Enter a title.")).toBeVisible();
    // v4.7: the same fields as an existing task, not a short form.
    for (const field of ["Status", "Assignee", "Secondary assignee", "Priority", "Epic", "Scope", "Type"]) {
      await expect(dialog.getByRole("combobox", { name: field, exact: true })).toBeVisible();
    }
    await expect(dialog.getByRole("textbox", { name: "Description" })).toBeVisible();
    // Checklist, files and a comment are there too; what's entered is saved onto the task when it's created.
    await expect(dialog.getByRole("button", { name: "Attach files" })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Add a comment" })).toBeVisible();
    await dialog.getByLabel("New checklist item").fill("Label both ends");
    await dialog.getByLabel("New checklist item").press("Enter");
    await expect(dialog.getByText("0 of 1 done")).toBeVisible();
    await dialog.getByLabel("Title").fill("Coil the XLR cables");
    await expectNoViolations(page, "[role=dialog]");
    await dialog.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByText(`${project.key}-4 created.`).first()).toBeVisible();
    // The new task opens straight away, checklist included; closing it shows the card on the board.
    const opened = page.getByRole("dialog", { name: `${project.key}-4` });
    await expect(opened).toBeVisible();
    await expect(opened.getByRole("checkbox", { name: "Label both ends" })).toBeVisible();
    if (v === "mobile") await opened.getByRole("button", { name: "Back to board" }).click();
    else await page.keyboard.press("Escape");
    await expect(column(page, "Backlog").getByRole("button", { name: "Coil the XLR cables", exact: true })).toBeAttached();
  });
});

test.describe("v4.7 project switcher on phones", () => {
  test("the top bar names the open project and switches projects, keeping the section", async ({ pageAs }, testInfo) => {
    const v = viewportOf(testInfo);
    test.skip(v !== "mobile", "Tablets and desktops switch projects from the sidebar.");
    const project = BOARD_PROJECTS.mobile;
    const page = await pageAs(persona("mover", "mobile"));
    await page.goto(`/projects/${project.key}?view=backlog`);
    const switcher = page.getByRole("button", { name: `Project: ${project.name}. Switch project` });
    await expect(switcher).toBeVisible();
    await switcher.click();
    const sheet = page.getByRole("dialog", { name: "Switch project" });
    const current = sheet.getByRole("link", { name: new RegExp(project.name) });
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(current).toHaveAttribute("href", `/projects/${project.key}?view=backlog`);
    await expect(sheet.getByRole("link", { name: "All projects" })).toBeVisible();
    await expectNoViolations(page, "[role=dialog]");
    await sheet.getByRole("link", { name: "All projects" }).click();
    await expect(sheet).toBeHidden();
    // Outside a project the logo is back and there's no switcher.
    await expect(page.getByRole("button", { name: /Switch project/ })).toHaveCount(0);
  });
});

test.describe("TASK-2 list view and TASK-10 bulk edit", () => {
  test("sorts, selects and moves several tasks at once", async ({ pageAs }, testInfo) => {
    const v = viewportOf(testInfo);
    test.skip(v !== "desktop", "Selecting rows for bulk edit is checked on desktop; phones get the same bar.");
    const project = BOARD_PROJECTS.desktop;
    const page = await pageAs(persona("mover", "desktop"));
    await page.goto(`/projects/${project.key}?view=list`);
    // From tablet width up the project's pages are in the sidebar (v4.7).
    await expect(page.getByRole("list", { name: `${project.name} pages` }).getByRole("link", { name: "List" })).toHaveAttribute("aria-current", "page");
    const table = page.getByRole("table", { name: "Tasks" });
    await table.getByRole("button", { name: "Title" }).click();
    await expect(table.getByRole("columnheader", { name: "Title" })).toHaveAttribute("aria-sort", "ascending");
    await table.getByRole("checkbox", { name: `Select ${project.key}-1` }).click();
    await table.getByRole("checkbox", { name: `Select ${project.key}-4` }).click();
    const bar = page.getByRole("region", { name: "Bulk edit" });
    await expect(bar).toContainText("2 tasks selected");
    await expectNoViolations(page);
    await bar.getByRole("button", { name: "Status" }).click();
    await page.getByRole("menuitem", { name: "In Review" }).click();
    await expect(page.getByText("Updated 2 tasks.").first()).toBeVisible();
    await expect(table.getByRole("row", { name: new RegExp(`${project.key}-1`) })).toContainText("In Review");
  });

  test("TASK-12 phone rows offer complete and reassign from the row menu", async ({ pageAs }, testInfo) => {
    test.skip(viewportOf(testInfo) !== "mobile", "Phone layout.");
    const project = BOARD_PROJECTS.mobile;
    const page = await pageAs(persona("mover", "mobile"));
    await page.goto(`/projects/${project.key}?view=list`);
    await page.getByRole("button", { name: `Actions for ${project.key}-1` }).click();
    await page.getByRole("menuitem", { name: "Mark complete" }).click();
    await expect(page.getByRole("list", { name: "Tasks" }).getByRole("listitem").filter({ hasText: `${project.key}-1` })).toContainText("Done");
    await expectNoViolations(page);
  });
});
