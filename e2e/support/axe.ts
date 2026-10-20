import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// NFR-13 / section 13: WCAG 2.2 AA plus axe best practices.
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/**
 * Runs axe on the page, or only on `within` when given. Open Radix menus and selects are modal:
 * they trap focus and set aria-hidden on everything else, which axe reports as aria-hidden-focus and
 * a missing h1 even though the background cannot be reached. The full page is scanned closed, so with
 * one of those open only the popup itself is scanned.
 */
export async function expectNoViolations(page: Page, within?: string) {
  // Wait for opening animations (dialogs fade and slide in) so contrast isn't measured mid-fade.
  // Endless ones, like skeleton shimmer, are ignored.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity),
  );
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
