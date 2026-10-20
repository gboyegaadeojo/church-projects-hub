import { expect, type Page } from "@playwright/test";
import { ACCESS_COPY } from "../shared/access";
import { HUB_FEEDBACK } from "../shared/projects";
import { expectNoViolations } from "./support/axe";
import { persona } from "./support/fixtures";
import { test, viewportOf } from "./support/pageAs";

// Stage 2c: the app shell (section 12), My Work (section 11.1), projects (PROJ-1, PROJ-6, PROJ-7),
// the theme on the profile (section 9), and the public home and privacy pages (AUTH-10, section 11.15).
// Breakpoints: desktop 1440 and mobile 360 come from the Playwright projects; tablet 768 is set per test.

const TABLET = { width: 768, height: 1024 };
const WELCOME = /^Good (morning|afternoon|evening) 👋 Here's what needs your attention this week\.$/;

const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });

/** No unintended horizontal scrolling (section 12). */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`NFR-13 app shell in ${scheme} mode`, () => {
    test("My Work with the shell for a member", async ({ pageAs }, testInfo) => {
      const page = await pageAs(persona("contributor"), scheme);
      await page.goto("/work");
      await expect(page.getByRole("heading", { level: 1, name: "My Work" })).toBeVisible();
      await expect(page.getByText(WELCOME)).toBeVisible();
      await expect(page.getByText("You're all caught up. Check the board for work you can pick up.")).toBeVisible();

      const nav = mainNav(page);
      await expect(nav.getByRole("link", { name: "My Work" })).toHaveAttribute("aria-current", "page");
      if (viewportOf(testInfo) === "desktop") {
        await expect(nav.getByRole("link", { name: "Media" })).toBeVisible();
        // A Contributor has no admin area, and never sees Hub Feedback (PROJ-7).
        await expect(nav.getByRole("link", { name: "Administration" })).toHaveCount(0);
        await expect(nav.getByRole("link", { name: "Access requests" })).toHaveCount(0);
        await expect(nav.getByRole("link", { name: HUB_FEEDBACK.name })).toHaveCount(0);
      } else {
        await expect(nav.getByRole("link", { name: "Projects" })).toBeVisible();
        await expect(nav.getByRole("button", { name: "Me" })).toBeVisible();
        await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(0);
      }
      await expectNoHorizontalOverflow(page);
      await expectNoViolations(page);
    });

    test("the account panel: theme, request more projects, privacy, sign out", async ({ pageAs }, testInfo) => {
      const page = await pageAs(persona("contributor"), scheme);
      await page.goto("/work");
      if (viewportOf(testInfo) === "desktop") {
        await page.getByRole("button", { name: /Sam Contributor/ }).click();
      } else {
        await mainNav(page).getByRole("button", { name: "Me" }).click();
        await expect(page.getByRole("dialog", { name: "Your account" })).toBeVisible();
      }
      await expect(page.getByRole("radiogroup", { name: "Theme" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Request access to more projects" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      await expectNoViolations(page);
      await page.keyboard.press("Escape");
    });

    test("Section 11.12 the admin area: one entry, an overview, and its own navigation", async ({ pageAs }, testInfo) => {
      const page = await pageAs(persona("admin"), scheme);
      await page.goto("/work");
      // Everyday navigation holds a single way in; the admin tools themselves live inside it.
      const entry = viewportOf(testInfo) === "desktop" ? "Administration" : "Admin";
      await expect(mainNav(page).getByRole("link", { name: "Access requests" })).toHaveCount(0);
      await mainNav(page).getByRole("link", { name: entry, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Administration" })).toBeVisible();
      const main = page.getByRole("main");
      for (const group of ["People", "Projects", "System"]) await expect(main.getByRole("heading", { level: 2, name: group })).toBeVisible();
      for (const tool of ["Access requests", "Users", "Manage projects", "Church reports", "Audit log", "Usage", "Data deletion"]) {
        await expect(main.getByRole("link", { name: new RegExp(`^${tool}`) })).toBeVisible();
      }
      await expectNoViolations(page);
      await main.getByRole("link", { name: /^Manage projects/ }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Manage projects" })).toBeVisible();
      // Desktop: the sidebar becomes the admin navigation; everywhere: a breadcrumb back to the overview.
      if (viewportOf(testInfo) === "desktop") {
        const adminNav = page.getByRole("navigation", { name: "Admin" });
        await expect(adminNav.getByRole("link", { name: "Manage projects" })).toHaveAttribute("aria-current", "page");
        await expect(adminNav.getByRole("link", { name: "Back to My Work" })).toBeVisible();
      }
      await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Administration" })).toBeVisible();
    });

    test("an App Admin's Manage projects page", async ({ pageAs }) => {
      const page = await pageAs(persona("admin"), scheme);
      await page.goto("/admin/projects");
      await expect(page.getByRole("heading", { level: 1, name: "Manage projects" })).toBeVisible();
      // PROJ-7: Hub Feedback exists once an App Admin has loaded the app, marked as built in.
      const hub = page.getByRole("row").filter({ hasText: HUB_FEEDBACK.name });
      await expect(hub.getByText("App Admins only")).toBeVisible();
      await expect(hub.getByText("Built in")).toBeVisible();
      await expectNoViolations(page);

      await page.getByRole("button", { name: "New project" }).click();
      const dialog = page.getByRole("dialog", { name: "New project" });
      await expect(dialog.getByLabel("Name")).toBeFocused();
      await expectNoViolations(page);
      await page.keyboard.press("Escape");

      // PROJ-7: App Admins find Hub Feedback among their projects.
      await page.goto("/projects");
      await expect(page.getByRole("main").getByRole("link", { name: new RegExp(HUB_FEEDBACK.name) })).toBeVisible();
    });

    test("a member with no projects sees the request link (section 11.1)", async ({ pageAs }) => {
      const page = await pageAs(persona("loner"), scheme);
      await page.goto("/work");
      await expect(page.getByText(ACCESS_COPY.noProjects)).toBeVisible();
      await page.getByRole("link", { name: "Request access" }).click();
      await expect(page).toHaveURL(/\/request-access$/);
    });

    test("tablet: a collapsible icon rail", async ({ pageAs }, testInfo) => {
      test.skip(viewportOf(testInfo) !== "desktop", "tablet size is set on the desktop project");
      const page = await pageAs(persona("admin"), scheme, TABLET);
      await page.goto("/work");
      const nav = mainNav(page);
      // Collapsed: icons with accessible names, no visible labels.
      await expect(nav.getByRole("link", { name: "My Work" })).toBeVisible();
      await expect(nav.getByText("My Work", { exact: true })).toHaveCount(0);
      await expectNoViolations(page);
      const expand = page.getByRole("button", { name: "Expand sidebar" });
      await expect(expand).toHaveAttribute("aria-expanded", "false");
      await expand.click();
      await expect(nav.getByText("My Work", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute("aria-expanded", "true");
      await expectNoHorizontalOverflow(page);
      await expectNoViolations(page);
    });

    test("public home and privacy pages (AUTH-10)", async ({ pageAs }) => {
      const page = await pageAs(null, scheme);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1, name: "Church Projects Hub" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
      await expectNoViolations(page);
      await page.getByRole("link", { name: "Privacy policy" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
      for (const heading of [
        "What we get from Google",
        "What the hub stores",
        "Who can see it",
        "Keep children's and pastoral details out",
        "How long we keep it",
        "Asking us to delete your data",
        "Contact",
      ]) {
        await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
      }
      await expect(page.getByRole("link", { name: "media@ifcwpg.com" }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoViolations(page);
    });
  });
}

test.describe("Shell flows", () => {
  test("PROJ-1 and PROJ-6 an App Admin creates a hidden project, and it stays off the request screen", async ({ pageAs }, testInfo) => {
    const v = viewportOf(testInfo);
    const name = `Prayer ${v}`;
    const key = v === "desktop" ? "PRAYD" : "PRAYM";
    const admin = await pageAs(persona("admin"));
    await admin.goto("/admin/projects");
    await admin.getByRole("button", { name: "New project" }).click();
    const dialog = admin.getByRole("dialog", { name: "New project" });

    // Nothing filled in: each field explains the fix.
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(dialog.getByText("Enter a name for the project.")).toBeVisible();

    await dialog.getByLabel("Name").fill(name);
    // The key is suggested from the name; replace it with our own.
    await expect(dialog.getByLabel("Key")).toHaveValue("PRAYER");
    await dialog.getByLabel("Key").fill(key.toLowerCase());
    await expect(dialog.getByLabel("Key")).toHaveValue(key);
    await dialog.getByLabel("Description").fill("Prayer requests from the Sunday team.");
    await dialog.getByRole("radio", { name: "Purple" }).click();
    await dialog.getByRole("radio", { name: "Book" }).click();
    await dialog.getByRole("switch", { name: "Hidden (invite only)" }).click();
    await dialog.getByRole("button", { name: "Create project" }).click();

    await expect(admin.getByText("Project created.").first()).toBeVisible();
    await expect(dialog).toBeHidden();
    const row = admin.getByRole("row").filter({ hasText: name });
    await expect(row.getByText("Hidden: invite only")).toBeVisible();

    // A duplicate key is refused on the field.
    await admin.getByRole("button", { name: "New project" }).click();
    await dialog.getByLabel("Name").fill("Another");
    await dialog.getByLabel("Key").fill(key);
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(dialog.getByText("Another project already uses that key. Choose a different one.")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // The project page opens from the Projects list.
    await admin.goto("/projects");
    await admin.getByRole("main").getByRole("link", { name: new RegExp(name) }).click();
    await expect(admin.getByRole("heading", { level: 1, name })).toBeVisible();

    // PROJ-6: invite-only, so a pending person can't ask for it.
    const pending = await pageAs(persona("pendingNew"));
    await pending.goto("/request-access");
    await expect(pending.getByRole("checkbox", { name: /Media/ })).toBeVisible();
    await expect(pending.getByRole("checkbox", { name: new RegExp(name) })).toHaveCount(0);

    // Editing: un-hide it, and it appears on the request screen.
    await admin.goto("/admin/projects");
    await admin.getByRole("row").filter({ hasText: name }).getByRole("button", { name: `Edit ${name}` }).click();
    const edit = admin.getByRole("dialog", { name: `Edit ${name}` });
    await edit.getByRole("switch", { name: "Hidden (invite only)" }).click();
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(admin.getByText("Saved.").first()).toBeVisible();
    await pending.reload();
    await expect(pending.getByRole("checkbox", { name: new RegExp(name) })).toBeVisible();
  });

  test("Section 9 the theme follows the profile to a new browser", async ({ pageAs }, testInfo) => {
    const who = persona("themer", viewportOf(testInfo));
    const page = await pageAs(who, "light");
    await page.goto("/work");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    if (viewportOf(testInfo) === "desktop") await page.getByRole("button", { name: new RegExp(who.name) }).click();
    else await mainNav(page).getByRole("button", { name: "Me" }).click();
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/me/preferences") && r.ok());
    await page.getByRole("radio", { name: "Dark" }).click();
    await saved;
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // A fresh browser (no saved theme) with the OS in light mode: the profile's Dark wins after sign-in.
    const other = await pageAs(who, "light");
    await other.goto("/work");
    await expect(other.getByRole("heading", { level: 1, name: "My Work" })).toBeVisible();
    await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
    // And it is kept for the next first paint, signed out included.
    await other.goto("/privacy");
    await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("Section 11.7 pending people get no app navigation", async ({ pageAs }) => {
    const page = await pageAs(persona("pendingNew"));
    await page.goto("/work");
    await expect(page).toHaveURL(/\/request-access$/);
    await expect(mainNav(page)).toHaveCount(0);
    await page.goto("/admin/projects");
    await expect(page).toHaveURL(/\/request-access$/);
  });

  test("Section 13 keyboard: skip link, then focus moves to the new page after navigating", async ({ pageAs }, testInfo) => {
    test.skip(viewportOf(testInfo) !== "desktop", "keyboard path checked on desktop");
    const page = await pageAs(persona("contributor"));
    await page.goto("/work");
    await expect(page.getByRole("heading", { level: 1, name: "My Work" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await mainNav(page).getByRole("link", { name: "All projects" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    await expect(page.locator("main#main")).toBeFocused();
  });
});
