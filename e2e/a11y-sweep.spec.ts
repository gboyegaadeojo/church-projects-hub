import { expect } from "@playwright/test";
import { expectNoViolations } from "./support/axe";
import { BOARD_PROJECTS, DETAIL_PROJECTS, persona } from "./support/fixtures";
import { test, viewportOf } from "./support/pageAs";

// Stage 8, section 17 "Run axe on every key screen": one pass over every screen in the app, in both themes,
// at desktop (1440) and mobile (360). Other files check screens in particular states (dialogs open, errors
// shown); this one makes sure no screen is missed. Read-only: it changes nothing.

type Screen = { name: string; path: (v: "desktop" | "mobile") => string; who: "admin" | "mover" | null };

const SCREENS: Screen[] = [
  { name: "Home", path: () => "/", who: null },
  { name: "Privacy", path: () => "/privacy", who: null },
  { name: "My Work", path: () => "/work", who: "mover" },
  { name: "Projects", path: () => "/projects", who: "mover" },
  { name: "Board", path: (v) => `/projects/${BOARD_PROJECTS[v].key}`, who: "mover" },
  { name: "List", path: (v) => `/projects/${BOARD_PROJECTS[v].key}?view=list`, who: "mover" },
  { name: "Task detail", path: (v) => `/projects/${DETAIL_PROJECTS[v].key}?task=${DETAIL_PROJECTS[v].key}-3`, who: "mover" },
  { name: "Project reports", path: (v) => `/projects/${BOARD_PROJECTS[v].key}/reports`, who: "mover" },
  { name: "Project members", path: (v) => `/projects/${BOARD_PROJECTS[v].key}/members`, who: "mover" },
  { name: "Search", path: () => "/search?q=mic", who: "mover" },
  { name: "Notifications", path: () => "/notifications", who: "mover" },
  { name: "Email settings", path: () => "/settings/notifications", who: "mover" },
  { name: "Your data", path: () => "/settings/data", who: "mover" },
  { name: "What's New", path: () => "/whats-new", who: "mover" },
  { name: "Your feedback", path: () => "/feedback", who: "mover" },
  { name: "Report a bug", path: () => "/feedback/bug", who: "mover" },
  { name: "Request a feature", path: () => "/feedback/feature", who: "mover" },
  { name: "Request more projects", path: () => "/request-access", who: "mover" },
  { name: "Administration", path: () => "/admin", who: "admin" },
  { name: "Access requests", path: () => "/admin/requests", who: "admin" },
  { name: "Users", path: () => "/admin/users", who: "admin" },
  { name: "Manage projects", path: () => "/admin/projects", who: "admin" },
  { name: "Church reports", path: () => "/admin/reports", who: "admin" },
  { name: "Audit log", path: () => "/admin/audit", who: "admin" },
  { name: "Usage", path: () => "/admin/usage", who: "admin" },
  { name: "Data deletion", path: () => "/admin/deletions", who: "admin" },
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`NFR-13 axe sweep in ${scheme} mode`, () => {
    for (const screen of SCREENS) {
      test(screen.name, async ({ pageAs }, testInfo) => {
        const v = viewportOf(testInfo);
        const who = screen.who === "admin" ? persona("admin") : screen.who === "mover" ? persona("mover", v) : null;
        const page = await pageAs(who, scheme);
        await page.goto(screen.path(v));
        // Generous first wait: the dev server compiles a screen's code the first time it is opened.
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
        // Let data load: nothing marked busy (skeletons) before scanning.
        await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
        await expectNoViolations(page);
      });
    }
  });
}
