import { expect } from "@playwright/test";
import { expectNoViolations } from "./support/axe";
import { persona } from "./support/fixtures";
import { test, viewportOf } from "./support/pageAs";

// FDBK-1 to FDBK-4 / section 11.9: What's New with its dot, and the feedback forms landing in Hub Feedback.

test("FDBK-1 an App Admin publishes; a member sees the dot until they open What's New", async ({ pageAs }, testInfo) => {
  const v = viewportOf(testInfo);
  const admin = await pageAs(persona("admin"));
  await admin.goto("/whats-new");
  await admin.getByRole("button", { name: "New post" }).click();
  const dialog = admin.getByRole("dialog", { name: "New post" });
  await dialog.getByRole("textbox", { name: "Title" }).fill(`Email digests ${v}`);
  await dialog.getByRole("textbox", { name: "What changed" }).fill("**New:** a 7 am digest\n\n- choose instant or digest\n- [settings](/settings/notifications)");
  await expect(dialog.getByRole("region", { name: "Preview" }).getByText("New:")).toBeVisible();
  await expectNoViolations(admin, "[role=dialog]");
  await dialog.getByRole("button", { name: "Publish" }).click();
  await expect(admin.getByRole("heading", { level: 2, name: `Email digests ${v}` })).toBeVisible();

  const page = await pageAs(persona("themer", v));
  await page.goto("/work");
  const help = page.getByRole("button", { name: "Help, new updates" });
  await expect(help).toBeVisible();
  await help.click();
  await page.getByRole("dialog", { name: "Help" }).getByRole("link", { name: /What's New/ }).click();
  const post = page.getByRole("article", { name: `Email digests ${v}` });
  await expect(post.getByRole("listitem").first()).toHaveText("choose instant or digest");
  await expect(post.getByRole("link", { name: "settings" })).toHaveAttribute("href", "/settings/notifications");
  await expect(page.getByRole("button", { name: "New post" })).toHaveCount(0);
  await expectNoViolations(page);
  await expect(page.getByRole("button", { name: "Help", exact: true })).toBeVisible();
});

test("FDBK-2 / FDBK-4 a bug report records the page and shows on Your feedback", async ({ pageAs }, testInfo) => {
  const v = viewportOf(testInfo);
  const page = await pageAs(persona("themer", v));
  await page.goto("/projects");
  await page.getByRole("button", { name: /^Help/ }).click();
  await page.getByRole("dialog", { name: "Help" }).getByRole("link", { name: "Report a bug" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Report a bug" })).toBeVisible();
  await expect(page.getByText("(/projects)")).toBeVisible();
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Tell us what happened.")).toBeVisible();
  await expectNoViolations(page);
  await page.getByRole("textbox", { name: "What happened?" }).fill(`The projects page flickered ${v}`);
  await page.getByRole("textbox", { name: "What did you expect to happen?" }).fill("A steady list");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page).toHaveURL(/\/feedback$/);
  await expect(page.getByRole("listitem").filter({ hasText: `The projects page flickered ${v}` })).toContainText("Backlog");
  await expectNoViolations(page);
});

test("FDBK-3 a feature request needs a title, description and why", async ({ pageAs }, testInfo) => {
  const page = await pageAs(persona("themer", viewportOf(testInfo)));
  await page.goto("/feedback/feature");
  await page.getByRole("button", { name: "Send idea" }).click();
  await expect(page.getByText("Give your idea a short title.")).toBeVisible();
  await page.getByRole("textbox", { name: "Title" }).fill("Print view for the board");
  await page.getByRole("textbox", { name: "Description" }).fill("A printable list per column");
  await page.getByRole("textbox", { name: "Why does it matter?" }).fill("For the Sunday huddle");
  await page.getByRole("button", { name: "Send idea" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Print view for the board" }).first()).toBeVisible();
});
