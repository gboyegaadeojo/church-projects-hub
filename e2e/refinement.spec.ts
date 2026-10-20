import { expect, type Page } from "@playwright/test";
import { expectNoViolations } from "./support/axe";
import { BOARD_PROJECTS, persona } from "./support/fixtures";
import { test, viewportOf } from "./support/pageAs";

// Stage 4: command palette (NAV-2, section 11.11), offline banner and read-only (section 11.10, TASK-13,
// NFR-20), maintenance page (NFR-18), request access inside the shell, and every key screen at 360, 768,
// 1024 and 1440 px and at 200% zoom (section 12).

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `sideways scroll on ${page.url()}`).toBeLessThanOrEqual(0);
}

test("NAV-2 Ctrl+K opens the palette; it finds projects and actions and returns focus on Escape", async ({ pageAs }, testInfo) => {
  const v = viewportOf(testInfo);
  const project = BOARD_PROJECTS[v];
  const page = await pageAs(persona("mover", v));
  await page.goto("/work");
  await expect(page.getByRole("heading", { level: 1, name: "My Work" })).toBeVisible();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Go to" });
  const input = palette.getByRole("combobox", { name: "Search projects, tasks and actions" });
  await expect(input).toBeFocused();
  await expect(palette.getByRole("group", { name: "Actions" })).toBeVisible();
  await expectNoViolations(page, "[role=dialog]");

  await input.fill(project.name);
  const option = palette.getByRole("group", { name: "Projects" }).getByRole("option", { name: new RegExp(`^${project.name}`) });
  await expect(option).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/projects/${project.key}$`));
  await expect(palette).toHaveCount(0);

  // A key jumps to the task.
  await page.keyboard.press("Control+k");
  await input.fill(`${project.key}-3`);
  await expect(palette.getByRole("group", { name: "Tasks" }).getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: `${project.key}-3` })).toBeVisible();
  await page.keyboard.press("Escape");

  // Escape closes the palette and puts focus back where it was.
  const opener = v === "desktop" ? page.getByRole("button", { name: /Jump to/ }) : page.getByRole("button", { name: "New task" }).first();
  await opener.focus();
  await page.keyboard.press("Control+k");
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
});

test("Section 11.10 offline: amber banner, last saved view read-only, writes back on reconnect", async ({ pageAs }, testInfo) => {
  const v = viewportOf(testInfo);
  const project = BOARD_PROJECTS[v];
  const page = await pageAs(persona("mover", v));
  await page.goto(`/projects/${project.key}`);
  await expect(page.getByRole("button", { name: "New task" }).first()).toBeVisible();
  await page.context().setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "You're offline. Showing your last saved view" })).toBeVisible();
  // Write controls stay visible but disabled, saying why (section 11.10).
  const newTask = page.getByRole("button", { name: "New task" }).first();
  await expect(newTask).toHaveAttribute("aria-disabled", "true");
  await expectNoViolations(page);
  await newTask.hover();
  await expect(page.getByRole("tooltip").filter({ hasText: "Not available offline." })).toBeVisible();
  await expect(page.getByRole("button", { name: `Move ${project.key}-3: Not available offline.` })).toHaveAttribute("aria-disabled", "true");
  await page.context().setOffline(false);
  await expect(page.getByText("You're offline.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New task" }).first()).toBeVisible();
});

test("NFR-18 the maintenance page replaces the app when the database is unavailable", async ({ pageAs }) => {
  const page = await pageAs(persona("contributor"));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }));
  await page.goto("/work");
  await expect(page.getByRole("heading", { level: 1, name: "The hub is temporarily unavailable. We're aware and working on it." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expectNoViolations(page);
});

test("Active members request more projects inside the app shell", async ({ pageAs }) => {
  const page = await pageAs(persona("contributor"));
  await page.goto("/request-access");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Request access|Your requests|requests/i);
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
  await expectNoViolations(page);
});

test("Privacy policy mentions the offline copy of recently viewed pages", async ({ pageAs }) => {
  const page = await pageAs(null);
  await page.goto("/privacy");
  await expect(page.getByText(/your browser stores your theme choice and recently viewed pages so the app works offline/)).toBeVisible();
});

// Section 12: 360 and 1440 are the Playwright projects; 768 and 1024 are set here; 200% zoom on a 1280 × 800
// screen is a 640 × 400 CSS-pixel viewport.
const SIZES = [
  { name: "tablet 768", width: 768, height: 1024 },
  { name: "desktop 1024", width: 1024, height: 768 },
  { name: "200% zoom", width: 640, height: 400 },
] as const;

for (const size of SIZES) {
  test(`Section 12 key screens at ${size.name} have no sideways scrolling`, async ({ pageAs }, testInfo) => {
    test.skip(viewportOf(testInfo) !== "desktop", "Sizes are set explicitly; run once.");
    const project = BOARD_PROJECTS.desktop;
    const page = await pageAs(persona("mover", "desktop"), "light", { width: size.width, height: size.height });
    for (const path of ["/work", "/projects", "/search?q=mic", `/projects/${project.key}?view=list`, `/projects/${project.key}?task=${project.key}-3`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
    // The board scrolls sideways inside itself by design (section 12), never the page.
    await page.goto(`/projects/${project.key}`);
    await expect(page.getByRole("region", { name: "Board" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
