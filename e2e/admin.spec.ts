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
