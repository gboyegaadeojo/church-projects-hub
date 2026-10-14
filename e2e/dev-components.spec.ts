import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// NFR-13 / section 13: axe reports no WCAG 2.2 AA violations on /dev/components, in both themes,
// including with overlays open. The page renders a light and a dark column side by side, and the
// document theme is varied too so page-level chrome is checked in both.

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/**
 * Runs axe on the page, or only on `within` when given. Open Radix menus and selects are modal:
 * they trap focus and set aria-hidden on everything else, which axe reports as aria-hidden-focus and
 * a missing h1 even though the background cannot be reached. The full page is scanned closed, so with
 * one of those open only the popup itself is scanned.
 */
async function expectNoViolations(page: Page, within?: string) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (within) builder = builder.include(within);
  const results = await builder.analyze();
  const summary = results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5),
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}

async function openGallery(page: Page) {
  await page.goto("/dev/components");
  await expect(page.getByRole("heading", { level: 1, name: "Components" })).toBeVisible();
}

const lightColumn = (page: Page) => page.getByRole("region", { name: "Light theme" });
const darkColumn = (page: Page) => page.getByRole("region", { name: "Dark theme" });

for (const scheme of ["light", "dark"] as const) {
  test.describe(`NFR-13 /dev/components with the OS in ${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test("has no axe violations", async ({ page }) => {
      await openGallery(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
      await expectNoViolations(page);
    });
  });
}

test.describe("NFR-13 /dev/components overlays", () => {
  for (const column of [lightColumn, darkColumn]) {
    const name = column === lightColumn ? "light" : "dark";

    test(`confirmation dialogs (${name})`, async ({ page }) => {
      await openGallery(page);
      await column(page).getByRole("button", { name: "Delete task…" }).first().click();
      const dialog = page.getByRole("alertdialog", { name: "Delete MEDIA-42?" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
      await expectNoViolations(page);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      await column(page).getByRole("button", { name: "Archive project…" }).click();
      const typed = page.getByRole("alertdialog", { name: "Archive the Media project?" });
      await expect(typed.getByRole("button", { name: "Archive project" })).toBeDisabled();
      await expectNoViolations(page);
      await typed.getByLabel("Type MEDIA to confirm.").fill("MEDIA");
      await typed.getByRole("button", { name: "Archive project" }).click();
      await expect(typed).toBeHidden();
      await expect(page.getByText("Project archived.").first()).toBeVisible();
      await expectNoViolations(page);
    });

    test(`dialog, sheet, menu and select (${name})`, async ({ page }) => {
      await openGallery(page);

      await column(page).getByRole("button", { name: "Open dialog" }).click();
      await expect(page.getByRole("dialog", { name: "Rename project" })).toBeVisible();
      await expectNoViolations(page);
      await page.keyboard.press("Escape");
      await expect(column(page).getByRole("button", { name: "Open dialog" })).toBeFocused();

      await column(page).getByRole("button", { name: "Open sheet" }).click();
      await expect(page.getByRole("dialog", { name: /MEDIA-42/ })).toBeVisible();
      await expectNoViolations(page);
      await page.keyboard.press("Escape");

      await column(page).getByRole("button", { name: "Task actions" }).click();
      await expect(page.getByRole("menu")).toBeVisible();
      await expectNoViolations(page, "[role=menu]");
      await page.keyboard.press("Escape");
      await expect(column(page).getByRole("button", { name: "Task actions" })).toBeFocused();

      await column(page).getByRole("combobox").first().click();
      await expect(page.getByRole("listbox")).toBeVisible();
      await expectNoViolations(page, "[role=listbox]");
    });
  }
});

test.describe("Section 9 theme switch", () => {
  test("persists the choice and applies it on load", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openGallery(page);
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  test("sets the theme before the app script runs (no flash)", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("cph-theme", "dark"));
    await page.route("**/src/main.tsx", (route) => route.abort());
    await page.goto("/dev/components");
    // The app bundle never loaded, so the attribute can only come from the inline head script.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("System follows the OS", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openGallery(page);
    await page.getByRole("radio", { name: "System" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
