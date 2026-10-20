import { expect } from "@playwright/test";
import { expectNoViolations } from "./support/axe";
import { BOARD_PROJECTS, persona } from "./support/fixtures";
import { test, viewportOf } from "./support/pageAs";

// Section 16 / RPT-1 to RPT-4: the project reports page, table view, drill-down and CSV links.

test("RPT-1 a member sees the reports, switches a chart to a table, and drills down to the tasks", async ({ pageAs }, testInfo) => {
  const v = viewportOf(testInfo);
  const project = BOARD_PROJECTS[v];
  const page = await pageAs(persona("mover", v));
  await page.goto(`/projects/${project.key}`);
  await page.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${project.name} reports` })).toBeVisible();
  const status = page.getByRole("region", { name: "Status overview" });
  await expect(status).toContainText("open");
  await expect(page.getByRole("region", { name: "Workload" })).toHaveCount(0); // Contributors don't see workload.
  await expect(status.getByRole("link", { name: "Download Status overview as CSV" })).toHaveAttribute("href", /reports\/status\.csv\?weeks=12/);
  await expectNoViolations(page);
  await page.screenshot({ path: `test-results/reports-${v}.png`, fullPage: true });

  await status.getByRole("button", { name: "Show as table" }).click();
  await expect(status.getByRole("table", { name: "Status overview" })).toBeVisible();

  await page.getByRole("combobox", { name: "Date range" }).click();
  await page.getByRole("option", { name: "Last 4 weeks" }).click();
  await expect(page).toHaveURL(/weeks=4/);

  await status.getByRole("link", { name: "View tasks" }).click();
  await expect(page).toHaveURL(/category=open/);
  await expect(page.getByRole("status").filter({ hasText: "From a report: showing open tasks." })).toBeVisible();
  await page.getByRole("button", { name: "Show all tasks" }).click();
  await expect(page).not.toHaveURL(/category=/);
});

test("Section 16 App Admins see church-wide reports; members don't get the link", async ({ pageAs }, testInfo) => {
  const v = viewportOf(testInfo);
  const page = await pageAs(persona("admin"));
  await page.goto("/admin/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Church-wide reports" })).toBeVisible();
  await expect(page.getByRole("region", { name: "All projects" }).getByRole("link", { name: "Media" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Access and adoption" })).toContainText("Waiting requests");
  await expectNoViolations(page);
  await page.screenshot({ path: `test-results/church-${v}.png`, fullPage: true });

  const member = await pageAs(persona("mover", v));
  await member.goto("/admin/reports");
  await expect(member.getByText("Only app admins can see church-wide reports.")).toBeVisible();
});
