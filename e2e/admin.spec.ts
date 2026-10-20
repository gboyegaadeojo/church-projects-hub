import { expect } from "@playwright/test";
import { expectNoViolations } from "./support/axe";
import { persona } from "./support/fixtures";
import { test, viewportOf } from "./support/pageAs";

// ADM-2 / section 11.12 user directory, section 11.14 type-to-confirm, PROJ-4 archive.

test("ADM-2 an App Admin finds someone, suspends them by typing their email, and restores them", async ({ pageAs }, testInfo) => {
  const v = viewportOf(testInfo);
  const target = persona("suspendee", v);
  const page = await pageAs(persona("admin"));
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search by name or email" }).fill(target.email);
  await expect(page.getByRole("cell", { name: target.email })).toBeVisible();
  await expectNoViolations(page);

  await page.getByRole("button", { name: `Manage ${target.name}` }).click();
  const sheet = page.getByRole("dialog", { name: target.name });
  await expect(sheet.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expectNoViolations(page, "[role=dialog]");
  await sheet.getByRole("button", { name: "Suspend" }).click();

  const confirm = page.getByRole("alertdialog", { name: `Suspend ${target.name}?` });
  const destroy = confirm.getByRole("button", { name: "Suspend user" });
  await expect(destroy).toBeDisabled();
  await confirm.getByRole("textbox", { name: `Type ${target.email} to confirm.` }).fill(`  ${target.email.toUpperCase()} `);
  await destroy.click();
  await expect(page.getByText("User suspended.", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Suspended", { exact: true })).toBeVisible();

  await sheet.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("User restored.", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Active", { exact: true })).toBeVisible();
});

test("ADM-2 the admin can't suspend themselves", async ({ pageAs }) => {
  const me = persona("admin");
  const page = await pageAs(me);
  await page.goto("/admin/users");
  await page.getByRole("searchbox", { name: "Search by name or email" }).fill(me.email);
  await page.getByRole("button", { name: `Manage ${me.name}` }).click();
  const sheet = page.getByRole("dialog", { name: me.name });
  await expect(sheet.getByText("You can't do this to your own account.")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Suspend" })).toHaveCount(0);
});

test("Section 2 an App Admin lowers a member's role with confirmation and raises it back", async ({ pageAs }, testInfo) => {
  const member = persona("roler", viewportOf(testInfo));
  const page = await pageAs(persona("admin"));
  await page.goto("/projects/MEDIA");
  await page.getByRole("link", { name: "Members" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Media members" })).toBeVisible();
  await expectNoViolations(page);
  const role = page.getByRole("combobox", { name: `Role for ${member.name}` });
  await expect(role).toHaveText("Contributor");
  await role.click();
  await page.getByRole("option", { name: "Viewer" }).click();
  const confirm = page.getByRole("alertdialog", { name: `Change ${member.name} to Viewer?` });
  await confirm.getByRole("button", { name: "Change role" }).click();
  await expect(role).toHaveText("Viewer");
  await role.click();
  await page.getByRole("option", { name: "Contributor" }).click();
  await expect(role).toHaveText("Contributor");
});

test("ADM-7 a sent invite is listed and can be cancelled", async ({ pageAs }, testInfo) => {
  const email = `listed.${viewportOf(testInfo)}.${Date.now()}@example.org`;
  const page = await pageAs(persona("admin"));
  await page.goto("/admin/requests");
  await page.getByRole("combobox", { name: "Project" }).click();
  await page.getByRole("option", { name: "Media" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Send invite", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toContainText("Pending");
  await row.getByRole("button", { name: `Cancel invite for ${email}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel invite" }).click();
  await expect(row).toContainText("Cancelled");
  await expectNoViolations(page);
});

test("ADM-3 the audit log filters by action and offers a CSV export", async ({ pageAs }) => {
  const page = await pageAs(persona("admin"));
  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", /\/api\/admin\/audit\.csv/);
  await page.getByRole("combobox", { name: "Action" }).click();
  await page.getByRole("option", { name: "user.first_sign_in" }).click();
  await expect(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", /action=user\.first_sign_in/);
  await expect(page.getByRole("table").or(page.getByText("Nothing matches these filters.")).first()).toBeVisible();
  await expectNoViolations(page);
});

test("ADM-4 the usage panel shows emails and explains the missing analytics", async ({ pageAs }) => {
  const page = await pageAs(persona("admin"));
  await page.goto("/admin/usage");
  await expect(page.getByRole("meter", { name: "Emails sent today" })).toBeVisible();
  await expect(page.getByText("Worker and database numbers need Cloudflare analytics.")).toBeVisible();
  await expectNoViolations(page);
  await page.screenshot({ path: "test-results/usage-panel.png", fullPage: true });
});
