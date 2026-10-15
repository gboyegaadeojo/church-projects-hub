import { test as base, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { type Persona, sessionIdFor, sessionSecret, signedSessionCookie, type Viewport } from "./fixtures";

// The e2e server has its own seeded database (e2e/support/prepare-db.ts). People sign in by a seeded
// session cookie instead of Google; everything after that is the real Worker, middleware and D1.

const secret = sessionSecret();

export type Scheme = "light" | "dark";

type PageAs = (who: Persona | null, colorScheme?: Scheme, size?: { width: number; height: number }) => Promise<Page>;

/**
 * `pageAs(who)`: a page signed in as `who` (or signed out with null), in its own browser context, so
 * two people can be on screen in one test. `size` overrides the project's viewport (e.g. tablet).
 * Every context is closed when the test ends.
 */
export const test = base.extend<{ pageAs: PageAs }>({
  pageAs: async ({ browser }, use, testInfo) => {
    const { baseURL, viewport, hasTouch } = testInfo.project.use;
    const contexts: BrowserContext[] = [];
    await use(async (who, colorScheme = "light", size) => {
      const context = await browser.newContext({ baseURL, colorScheme, viewport: size ?? viewport, hasTouch });
      contexts.push(context);
      if (who) {
        await context.addCookies([
          {
            name: "__Host-cph_session",
            value: signedSessionCookie(sessionIdFor(who), secret),
            // __Host- cookies need domain + path here: Chromium rejects the `url` form for http origins.
            domain: new URL(baseURL!).hostname,
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
      }
      return context.newPage();
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
});

export const viewportOf = (testInfo: TestInfo) => testInfo.project.name as Viewport;
