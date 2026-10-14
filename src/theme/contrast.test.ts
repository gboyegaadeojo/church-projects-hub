// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// NFR-13 / section 13: text ≥ 4.5:1, UI component boundaries and focus rings ≥ 3:1, in both themes.
// Reads the palette blocks straight from src/index.css so the tokens and this check cannot drift apart.
// (Read from disk: Vitest replaces CSS imports, even ?raw, with an empty string.)

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function paletteBlock(selectorStart: string): Record<string, string> {
  const start = css.indexOf(selectorStart);
  if (start < 0) throw new Error(`Palette block not found: ${selectorStart}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("\n}", open);
  const body = css.slice(open + 1, close);
  const vars: Record<string, string> = {};
  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[match[1]!] = match[2]!.trim();
  return vars;
}

const palettes = {
  light: paletteBlock(":root,\n[data-theme=\"light\"]"),
  dark: paletteBlock("[data-theme=\"dark\"] {"),
};

function resolve(vars: Record<string, string>, name: string): string {
  let value = vars[name];
  for (let depth = 0; value?.startsWith("var(") && depth < 5; depth++) {
    value = vars[value.slice(6, -1)];
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`--${name} is not a 6-digit hex colour (got ${value})`);
  return value;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const surfaces = ["surface-page", "surface-card", "surface-elevated", "surface-hover"];

// [foreground, background, minimum ratio]
const pairs: Array<[string, string, number]> = [
  // Body and secondary text on every surface
  ...surfaces.flatMap((bg): Array<[string, string, number]> => [
    ["ink-primary", bg, 4.5],
    ["ink-secondary", bg, 4.5],
    ["accent-ink", bg, 4.5],
    ["danger-ink", bg, 4.5],
    ["success-ink", bg, 4.5],
    ["warning-ink", bg, 4.5],
    ["overdue-ink", bg, 4.5],
    ["due-soon-ink", bg, 4.5],
    ["done-ink", bg, 4.5],
    // Input borders, checkbox outlines and focus ring against the surface
    ["line-strong", bg, 3],
    ["focus-ring", bg, 3],
  ]),
  ["ink-primary", "surface-pressed", 4.5],
  // Disabled text: exempt in WCAG, held to 4.5:1 here anyway
  ["ink-disabled", "surface-disabled", 4.5],
  ["ink-disabled", "surface-card", 4.5],
  // Text on filled buttons, in every interaction state
  ["ink-on-accent", "accent", 4.5],
  ["ink-on-accent", "accent-hover", 4.5],
  ["ink-on-accent", "accent-pressed", 4.5],
  ["ink-on-danger", "danger", 4.5],
  ["ink-on-danger", "danger-hover", 4.5],
  ["ink-on-danger", "danger-pressed", 4.5],
  // Badges, alerts and selected chips: tinted text on its soft background
  ["accent-ink", "accent-soft", 4.5],
  ["danger-ink", "danger-soft", 4.5],
  ["ink-primary", "danger-soft", 4.5],
  ["success-ink", "success-soft", 4.5],
  ["warning-ink", "warning-soft", 4.5],
  ["info-ink", "info-soft", 4.5],
  ["overdue-ink", "overdue-soft", 4.5],
  ["due-soon-ink", "due-soon-soft", 4.5],
  ["done-ink", "done-soft", 4.5],
  // Tooltip: page colour on ink
  ["surface-page", "ink-primary", 4.5],
  // Filled controls against the page (checked checkbox, primary and destructive buttons)
  ["accent", "surface-page", 3],
  ["accent", "surface-card", 3],
  ["danger", "surface-page", 3],
  ["danger", "surface-card", 3],
];

describe("NFR-13 colour contrast", () => {
  for (const theme of ["light", "dark"] as const) {
    describe(`${theme} theme`, () => {
      it.each(pairs)(`--%s on --%s ≥ %s:1`, (fg, bg, min) => {
        const vars = palettes[theme];
        const ratio = contrast(resolve(vars, fg), resolve(vars, bg));
        expect(ratio, `${theme}: --${fg} on --${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
      });
    });
  }
});
