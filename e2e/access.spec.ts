import { expect } from "@playwright/test";
import { ACCESS_COPY } from "../shared/access";
import { expectNoViolations } from "./support/axe";
import { DENIAL_REASON, INVITES, persona } from "./support/fixtures";
import { test, viewportOf } from "./support/pageAs";

// Stage 2b screens in a real browser: request access and live status (AUTH-3, AUTH-8, section 11.6),
// the access queue (section 7), the confirmation token (section 11.14), invites (AUTH-9) and the
// security screens (section 11.7), with axe (NFR-13) in both themes.
//
// People sign in with seeded session cookies (e2e/support/pageAs.ts). People whose state changes have
// one copy per viewport, so desktop and mobile runs never collide.

for (const scheme of ["light", "dark"] as const) {
  test.describe(`NFR-13 access screens in ${scheme} mode`, () => {
    test("AUTH-3 request form, including the nothing-chosen error", async ({ pageAs }) => {
      const page = await pageAs(persona("pendingNew"), scheme);
      await page.goto("/request-access");
      await expect(page.getByRole("heading", { level: 1, name: "Request access" })).toBeVisible();
      await expect(page.getByRole("checkbox", { name: /Media/ })).toBeVisible();
      await expect(page.getByRole("checkbox", { name: /Hospitality/ })).toBeVisible();
      // PROJ-6: hidden projects are invite-only.
      await expect(page.getByRole("checkbox", { name: /Leadership/ })).toHaveCount(0);
      await expectNoViolations(page);

      await page.getByRole("button", { name: "Request access" }).click();
      await expect(page.getByRole("alert")).toHaveText("Choose at least one project.");
      await expectNoViolations(page);
    });

    test("AUTH-8 status screen with a denial reason and the Still waiting? prompt", async ({ pageAs }) => {
      const page = await pageAs(persona("pendingWaiting"), scheme);
      await page.goto("/request-access");
      await expect(page.getByRole("heading", { level: 1, name: "Your access requests" })).toBeVisible();
      await expect(page.getByText(ACCESS_COPY.reviewPromise)).toBeVisible();
      await expect(page.getByText(DENIAL_REASON)).toBeVisible();
      await expect(page.getByText(ACCESS_COPY.stillWaiting)).toBeVisible();
      await expect(page.getByRole("button", { name: "Send reminder" })).toBeEnabled();
      await expectNoViolations(page);
    });

    test("Section 7 access queue with the approve and deny dialogs open", async ({ pageAs }) => {
      const page = await pageAs(persona("admin"), scheme);
      await page.goto("/admin/requests");
      await expect(page.getByRole("heading", { level: 1, name: "Access requests" })).toBeVisible();
      const row = page.getByRole("row").filter({ hasText: "Robin Waiting" });
      await expect(row).toBeVisible();
      await expect(row.getByText("No project admin")).toBeVisible();
      await expectNoViolations(page);

      await row.getByRole("button", { name: "Approve" }).click();
      const approve = page.getByRole("dialog", { name: "Approve Robin Waiting?" });
      await expect(approve.getByRole("radio", { name: "Contributor" })).toBeChecked();
      await expectNoViolations(page);
      await approve.getByRole("button", { name: "Cancel" }).click();
      await expect(approve).toBeHidden();

      await row.getByRole("button", { name: "Deny" }).click();
      const deny = page.getByRole("alertdialog", { name: "Deny Robin Waiting's request?" });
      await expect(deny.getByRole("button", { name: "Deny request" })).toBeDisabled();
      await expectNoViolations(page);
      await page.keyboard.press("Escape");
      await expect(deny).toBeHidden();
    });

    test("Section 2 a Contributor sees the admins-only message on the queue", async ({ pageAs }) => {
      const page = await pageAs(persona("contributor"), scheme);
      await page.goto("/admin/requests");
      await expect(page.getByText("Only project and app admins can review access requests.")).toBeVisible();
      await expectNoViolations(page);
    });

    test("AUTH-9 invite landing when signed out", async ({ pageAs }) => {
      const page = await pageAs(null, scheme);
      await page.goto(`/invite/${INVITES.elsewhere.token}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "You've been invited to Hospitality as Viewer. Sign in with Google to accept." }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
      await expectNoViolations(page);
    });

    test("Section 11.7 security screens", async ({ pageAs }) => {
      const page = await pageAs(null, scheme);
      for (const [path, title] of [
        ["/suspended", "Access suspended"],
        ["/invite-expired", "Invitation expired"],
        ["/invite-mismatch", "Different account"],
      ] as const) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
        await expectNoViolations(page);
      }
    });

    test("The app shell links an admin to the access queue", async ({ pageAs }, testInfo) => {
      const page = await pageAs(persona("admin"), scheme);
      await page.goto("/work");
      // Sidebar on desktop; the Admin tab of the bottom bar on mobile (section 12).
      const name = viewportOf(testInfo) === "desktop" ? "Access requests" : "Admin";
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Access requests" })).toBeVisible();
      await expectNoViolations(page);
    });
  });
}

test.describe("Access flows", () => {
  test("AUTH-3 a pending person requests a project and sees it pending", async ({ pageAs }, testInfo) => {
    const page = await pageAs(persona("submitter", viewportOf(testInfo)));
    await page.goto("/request-access");
    await page.getByRole("checkbox", { name: /Hospitality/ }).check();
    await page.getByLabel("Note (optional)").fill("I can help set up on Sundays.");
    await page.getByRole("button", { name: "Request access" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Your access requests" })).toBeVisible();
    const item = page.getByRole("listitem").filter({ hasText: "Hospitality" });
    await expect(item.getByText("Pending")).toBeVisible();
    await expect(page.getByText(ACCESS_COPY.reviewPromise)).toBeVisible();
    await expectNoViolations(page);
  });

  test("AUTH-8 the reminder can be sent once, then waits 24 hours", async ({ pageAs }, testInfo) => {
    const page = await pageAs(persona("nudger", viewportOf(testInfo)));
    await page.goto("/request-access");
    await page.getByRole("button", { name: "Send reminder" }).click();
    await expect(page.getByText("Reminder sent.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Reminder sent" })).toBeDisabled();
  });

  test("Section 7 approving with a role makes the requester Active", async ({ pageAs }, testInfo) => {
    const requester = persona("approvee", viewportOf(testInfo));
    const admin = await pageAs(persona("admin"));
    await admin.goto("/admin/requests");
    const row = admin.getByRole("row").filter({ hasText: requester.name });
    await row.getByRole("button", { name: "Approve" }).click();
    const dialog = admin.getByRole("dialog", { name: `Approve ${requester.name}?` });
    await dialog.getByRole("radio", { name: "Viewer" }).check();
    await dialog.getByRole("button", { name: "Approve request" }).click();
    await expect(admin.getByText("Request approved.").first()).toBeVisible();
    await expect(row).toHaveCount(0);

    const page = await pageAs(requester);
    await page.goto("/request-access");
    await expect(page.getByRole("listitem").filter({ hasText: "Welcome team" }).getByText("Approved")).toBeVisible();
    await page.getByRole("link", { name: "Go to My Work" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "My Work" })).toBeVisible();
  });

  test("Section 11.14 denying needs a reason and sends the confirmation header", async ({ pageAs }, testInfo) => {
    const requester = persona("denyee", viewportOf(testInfo));
    const reason = "We have enough greeters for now.";
    const admin = await pageAs(persona("admin"));
    await admin.goto("/admin/requests");
    const row = admin.getByRole("row").filter({ hasText: requester.name });
    await row.getByRole("button", { name: "Deny" }).click();
    const dialog = admin.getByRole("alertdialog", { name: `Deny ${requester.name}'s request?` });
    const confirm = dialog.getByRole("button", { name: "Deny request" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Reason").fill(reason);

    const sent = admin.waitForRequest((r) => r.url().endsWith("/deny") && r.method() === "POST");
    await confirm.click();
    expect((await sent).headers()["x-confirm-action"]).toBe("access_request.deny");
    await expect(admin.getByText("Request denied.").first()).toBeVisible();
    await expect(row).toHaveCount(0);

    const page = await pageAs(requester);
    await page.goto("/request-access");
    const item = page.getByRole("listitem").filter({ hasText: "Welcome team" });
    await expect(item.getByText("Denied")).toBeVisible();
    await expect(item.getByText(reason)).toBeVisible();
  });

  test("AUTH-9 an admin creates an invite and the invited person accepts it", async ({ pageAs }, testInfo) => {
    const invitee = persona("invitee", viewportOf(testInfo));
    const admin = await pageAs(persona("admin"));
    await admin.goto("/admin/requests");
    await admin.getByRole("combobox", { name: "Project" }).click();
    await admin.getByRole("option", { name: "Hospitality" }).click();
    await admin.getByLabel("Email").fill(invitee.email);
    await admin.getByRole("button", { name: "Send invite" }).click();
    const created = admin.getByRole("status").filter({ hasText: "Invite sent." });
    await expect(created).toBeVisible();
    await expectNoViolations(admin);

    // The link points at APP_BASE_URL; open the same path on this server.
    const link = new URL((await created.locator("code").textContent()) ?? "");
    const page = await pageAs(invitee);
    await page.goto(link.pathname);
    await expect(page.getByRole("heading", { level: 1, name: "You've been invited to Hospitality as Contributor." })).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/work$/);
    await expect(page.getByRole("heading", { level: 1, name: "My Work" })).toBeVisible();
  });

  test("AUTH-9 a different Google account gets the mismatch copy and the invite stays unused", async ({ pageAs }) => {
    const page = await pageAs(persona("wrongAccount"));
    await page.goto(`/invite/${INVITES.elsewhere.token}`);
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/invite-mismatch$/);
    await expect(page.getByText(ACCESS_COPY.inviteMismatch)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expectNoViolations(page);

    // Still valid for the right person.
    await page.goto(`/invite/${INVITES.elsewhere.token}`);
    await expect(page.getByRole("button", { name: "Accept invitation" })).toBeVisible();
  });

  test("AUTH-9 an expired invite lands on the expired screen", async ({ pageAs }) => {
    const page = await pageAs(null);
    await page.goto(`/invite/${INVITES.expired.token}`);
    await expect(page).toHaveURL(/\/invite-expired$/);
    await expect(page.getByText(ACCESS_COPY.inviteExpired)).toBeVisible();
  });

  test("AUTH-6 a suspended person is sent to the suspended screen", async ({ pageAs }) => {
    const page = await pageAs(persona("suspended"));
    await page.goto("/work");
    await expect(page).toHaveURL(/\/suspended$/);
    await expect(page.getByRole("heading", { level: 1, name: "Access suspended" })).toBeVisible();
  });
});
