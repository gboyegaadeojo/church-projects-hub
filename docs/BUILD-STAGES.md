# Build stages

Nine stages, 0 to 8, matching section 20 of `docs/REQUIREMENTS.md`. Each stage ends with green CI, a stage report, and a merge to `main`.

## How to run a stage in VS Code with Claude Code

1. Start a new branch: `git switch -c stage-N/short-name`.
2. In Claude Code, run `/clear` so the stage starts with a clean context.
3. Switch to plan mode (Shift+Tab until it shows "plan mode") and paste the stage prompt below.
4. Read the plan. Correct anything that's off, then approve it so Claude Code starts building.
5. When it reports done, run `npm run typecheck`, `npm test` and `npm run build` yourself, and click through the app with `npm run dev`.
6. Commit, push, open a pull request on GitHub, wait for CI, merge.

Big stages (3, 5, 6) are best run one requirement group at a time; the prompts say where to split.

---

## Stage 0 — Repo setup (starter files already done)

Already in this repo: Worker + Hono, React + Vite, D1 and R2 bindings, one cron dispatcher, Tailwind tokens, home and privacy placeholders, Vitest in the Workers runtime, GitHub Actions CI, `CLAUDE.md`.

Do once on your computer:

1. Install Node 24 LTS (includes npm 11). npm 10 hits a known install bug with these packages, so check with `npm -v`.
2. Open the folder in VS Code, then in the terminal: `git init`, `git add .`, `git commit -m "Stage 0: starter"`.
3. Create a private GitHub repo (e.g. `church-projects-hub`), then `git remote add origin <url>` and `git push -u origin main`.
4. `npm install`, then `npm test` (6 tests should pass) and `npm run dev` — open http://localhost:5173 and http://localhost:5173/api/health.
5. Connect Cloudflare: `npx wrangler login` (use the church's Cloudflare account), then `npx wrangler d1 create church-projects-hub` and paste the `database_id` it prints into `wrangler.jsonc`. Run `npm run cf-typegen`.
6. `npx wrangler r2 bucket create church-projects-hub-files`. Cloudflare may ask you to enable R2 and add a payment method, even though usage stays in the free tier.

Done when: CI is green on GitHub and the health check shows `{"status":"ok","database":"ok"}`.

---

## Stage 1 — Design foundation

Requirements: sections 9, 10, 13, 15; NFR-13.

> Read CLAUDE.md and docs/REQUIREMENTS.md sections 9, 10, 13 and 15. Build the design foundation only, no features:
> 1. Complete the design tokens in src/index.css: every colour role in section 9 for light and dark (dark designed, not inverted, all text pairs at least 4.5:1), typography scale, spacing steps, radii, elevation, focus ring, motion durations and easing, touch target size. Add a theme switch (Light, Dark, System) that persists and applies without a flash.
> 2. Pick one icon set (Lucide) and add it.
> 3. Build the reusable components in section 15 using Radix primitives and tokens only: Button (primary, secondary, destructive, icon-only, loading), form controls with labels and field errors, Dialog and Sheet, the Confirmation dialog in section 11.14 (Cancel focused first, verb-named destructive button, optional type-to-confirm), Menu/Popover, Toast, Badge/Chip, Skeleton, Empty state, Error state, Table.
> 4. Add a development-only page at /dev/components showing every component in every state and both themes.
> 5. Add component tests for the confirmation dialog (focus order, Escape cancels, type-to-confirm) and an axe accessibility check of /dev/components.
> Plan first. Report per CLAUDE.md when done.

Done when: /dev/components shows every component and state in both themes, the tests pass, and axe reports no violations.

---

## Stage 2 — App shell, sign-in and access approval

Requirements: sections 2, 7, 11.6, 11.7, 11.15, 18; AUTH-1 to AUTH-10, PROJ-1, PROJ-6, PROJ-7, RATE-1, RATE-2, NFR-1, NFR-2, NFR-4, NFR-23.

Before starting: create the Google OAuth client (consent screen External) and put the values in `.dev.vars` (copy from `.dev.vars.example`). Add `http://localhost:5173/api/auth/callback` as an authorized redirect URI.

> Read CLAUDE.md and docs/REQUIREMENTS.md sections 2, 6, 7, 11.6, 11.7, 11.15 and 18. Build:
> 1. Drizzle schema and first migration for users, sessions, projects, project_members, access_requests, invites, workflow_states and audit_log (section 6).
> 2. Google sign-in with PKCE and state, ID token verification, server-side sessions in HttpOnly cookies, CSRF protection on writes, revocation checked on every request, last_seen_at throttled to 15 minutes.
> 3. Permission middleware implementing the matrix in section 2, with one API test per matrix row.
> 4. Pending flow: request screen, live status screen (polls only while visible), "Still waiting?" nudge, denial reason. Invites (AUTH-9). Approval rules in section 7. Audit events from section 6.
> 5. App shell: sidebar on desktop, bottom navigation on mobile (section 12), suspension and session-ended screens, home and privacy pages with final wording.
> 6. App Admin can create a project (PROJ-1), mark it hidden (PROJ-6); Hub Feedback system project auto-created and admin-only (PROJ-7). Seeded workflow columns.
> 7. Rate limits RATE-1 and RATE-2 with the exact copy.
> 8. README section and script for the first App Admin (section 18).
> 9. GitHub Actions: deploy.yml (on push to main, after CI: apply D1 migrations to production, then deploy; blocked Saturday 6 pm to Sunday 2 pm Winnipeg) and backup.yml (nightly 3 am Winnipeg: wrangler d1 export to R2, keep 30 days). Both use the CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID GitHub secrets.
> Split into pull requests: (a) schema + sign-in + sessions, (b) permissions + pending/approval + invites, (c) shell + pages + project creation, (d) deploy and backup workflows. Plan first.

After this stage: set the production secrets (`npx wrangler secret put …`), add the custom domain (hub.ifcwpg.com), publish the Google consent screen, and run the first-admin script for gboyega@ and kome@.

---

## Stage 3 — Core task experience

Requirements: sections 11.1 to 11.5, 11.11; TASK-1 to TASK-10, TASK-12, ORG-1 to ORG-5, NAV-1 to NAV-3, NFR-10 to NFR-12, NFR-24.

> Read CLAUDE.md and docs/REQUIREMENTS.md sections 3 (TASK, ORG, NAV), 6, 11.1 to 11.5 and 11.11. Build in this order, one pull request each:
> (a) Task schema (tasks, subtasks, labels, components, milestones, comments, attachments, watchers, task_events, tasks_fts) and the task API with optimistic concurrency and task history.
> (b) Board with drag and drop plus the keyboard Move alternative, list view with sort and filter, filter chips, mobile one-column board.
> (c) Task detail sheet/full-screen with inline editing, subtasks, comments with @mentions, conflict state, due-date rules.
> (d) Tiptap editor storing validated JSON (allowed nodes and marks per section 11.5, link schemes http/https/mailto) with plain-text copies; data-safety notice.
> (e) Attachments to R2 served through /api/attachments/:id with membership checks and content sniffing; delete via confirmation dialog.
> (f) My Work page and global search with FTS5.
> Every destructive action uses the confirmation dialog and writes an audit event. Plan first.

Done when: the Media team could run its backlog for a week. Consider a pilot with 2 or 3 volunteers here.

---

## Stage 4 — Interaction refinement and offline

Requirements: sections 10, 11.10, 11.13, 12; TASK-13, NAV-2, NFR-18, NFR-20, NFR-21.

> Read CLAUDE.md and docs/REQUIREMENTS.md sections 10, 11.10, 11.11, 11.13 and 12. Add: command palette (Cmd/Ctrl+K), toasts and skeletons everywhere data loads, designed empty and error states, React error boundaries reporting to a client-error endpoint, the D1 maintenance page, the service worker and PWA manifest (Workbox via the Vite PWA plugin), the offline banner with writes disabled, and the add-to-home-screen prompt after the second login. Check every screen at 360, 768, 1024 and 1440 px and at 200% zoom. Plan first.

---

## Stage 5 — Notifications, email, What's New and feedback

Requirements: section 8, 11.8, 11.9; NOTIF-1 to NOTIF-6, FDBK-1 to FDBK-5, RATE-3, NFR-9, NFR-19.

Before starting: authenticate ifcwpg.com in Brevo (section 8 table) and put `BREVO_API_KEY` in `.dev.vars`.

> Read CLAUDE.md and docs/REQUIREMENTS.md sections 8, 11.8 and 11.9. Build, one pull request each: (a) notifications table, bell with refresh rules and the unread-count header; (b) email_outbox written in the same transaction, the EmailSender interface with a Brevo implementation, the cron outbox sender with retries, dedupe keys and cap protection; (c) 7 am digests in each user's timezone, notification preferences and one-click unsubscribe; (d) What's New and the Report a Bug / Request a Feature forms landing in Hub Feedback, with RATE-3. Plan first.

---

## Stage 6 — Administration

Requirements: sections 11.12, 11.14; ADM-1 to ADM-8, NFR-15, NFR-16.

> Read CLAUDE.md and docs/REQUIREMENTS.md sections 3 (ADM), 6 and 11.12. Build the admin area: access request queue, user directory with suspend/restore and session revoke, invite management, audit log viewer with search and CSV export (streamed, 5,000-row cap), the usage panel reading Worker and D1 usage from Cloudflare's GraphQL analytics API (CF_ACCOUNT_ID, CF_ANALYTICS_TOKEN) plus emails from email_outbox, the 80% warning email, data deletion requests (ADM-6), the retention queue and purge (ADM-8), and the error-spike alert (NFR-15). High-impact actions use type-to-confirm. Plan first.

---

## Stage 7 — Reports

Requirements: section 16; RPT-1 to RPT-4.

> Read CLAUDE.md and docs/REQUIREMENTS.md section 16. Build report_snapshots computed incrementally by the hourly job (only new task_events since last_event_id), the report pages with accessible charts and text summaries, date-range and filters, "View tasks" drill-down, and CSV export. Confirm the hourly job stays under 10 ms CPU. Plan first.

---

## Stage 8 — Quality and launch

Requirements: sections 17, 20; NFR-6, NFR-8, NFR-11, NFR-13, NFR-22.

> Read CLAUDE.md and docs/REQUIREMENTS.md sections 17 and 20. Add the Playwright end-to-end suite in section 17, run axe on every key screen, measure board load (500 tasks, mid-range phone on 4G) and API p95, check CPU per request in Workers logs, replay one simulated Sunday at 50 users against the section 5 budget, and run a restore test from both backup paths. Write a launch checklist. Report measured numbers, not estimates.

Launch: Media team only, then add a second team within 90 days.
