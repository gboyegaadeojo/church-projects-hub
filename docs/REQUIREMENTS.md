# Church Projects Hub — Complete Engineering Requirements

Oct 14, 2026 · @G

**Version 4.5** — single engineer-ready document · **Owner:** @G, Immanuel Fellowship Church (IFC) · **Audience:** software engineers building and maintaining this product · **Status:** active baseline; pre-build decisions in section 21.

> This is the single source of truth. Read it fully before writing any code. Functional requirements take precedence over design guidance where they conflict. Any conflict found during implementation must be documented and brought to @G for a decision — never resolved silently.

## Change log

| Version | Date | Summary |
| --- | --- | --- |
| 4.5 | 20 Oct 2026 | Email provider changed from Brevo to Resend at @G's request, on the Resend free plan (100 emails/day, 3,000/month): instant emails switch to the digest at 80 a day (80%), Resend domain verification replaces Brevo's DNS records, `RESEND_API_KEY` replaces `BREVO_API_KEY`, and the free-tier email budget is recalculated (sections 5, 8, 18, 21). |
| 4.4 | 14 Oct 2026 | Stage 2c decisions: the My Work welcome follows the time of day in the user's timezone ("Good morning", "Good afternoon" from noon, "Good evening" from 5 pm) (section 11.1); the Hub Feedback project uses the key HUB, which is reserved for it (PROJ-7); Hub Feedback is created when an App Admin loads the app, not only at sign-in, because the first App Admin is promoted by script after signing in (section 18); a text wordmark stands in for the church logo until the logo file is supplied (sections 11.6, 11.15). |
| 4.3 | 14 Oct 2026 | Stage 1 decisions: "Confirmed action failed" copy added (section 14); type-to-confirm matching ignores letter case and leading or trailing spaces (section 11.14); side sheets round only their two inner corners, bottom sheets only their top corners (section 9); theme preference (Light, Dark, System) moves to the user's profile in Stage 2, with the browser setting kept as the fallback for signed-out pages and first paint. Stage 2a decisions: sign-in rate limit raised to 30 attempts per minute per IP, counted when sign-in starts (church Wi-Fi shares one IP) (NFR-4, RATE-1); "Sign-in didn't work" copy added (section 14); "sign-in rate limit hit" audit event written at most once per IP per minute (section 6). Stage 2b decisions: destructive actions carry an `X-Confirm-Action` header set only by the confirmation dialog, and the API returns 428 without it (sections 11.14, 17); invites are tied to the invited email, case-insensitive, with new mismatch copy (AUTH-9, section 14); RATE-2 counts one request per project, per calendar day in the user's timezone, and an over-limit submission is rejected whole. |
| 4.2 | 14 Oct 2026 | Pre-build review: Google sign-in publishing (public home and privacy pages, verified domain); Cloudflare API secrets for usage panel and backups; free-tier budget calculated for Workers, D1 and email; Brevo domain authentication; files served through the Worker; rich text stored as Tiptap JSON; confirmation screens for every destructive action; search, bell refresh, due-date, data-safety, retention purge, duplicate-account, audit-event and operations rules added. |
| 4.1 | 14 Oct 2026 | NFR-8 clarifies both restore paths; App Admin emails removed from env vars (resolved from DB); local migration setup added; section 19 simplified to the decided state; pre-code checklist gets owners and status; admin notification recipients resolved from DB at send time; success measure updated; domain decision updated. |
| 4.0 | 14 Oct 2026 | Merged design requirements document; added missing specs for file upload, rich text, notification bell, error boundaries, first deploy, and testing strategy. |
| 3.0 | 14 Oct 2026 | Merged functional requirements with design brief into one document. |
| 2.0 | 14 Oct 2026 | Twelve gaps filled; offline, integration, and graceful-degradation sections added. |
| 1.0 | 9 Oct 2026 | Initial functional requirements (checklist app context). |

## Contents

1. Product Summary and Goals
2. Users, Roles and Permissions
3. Functional Requirements
4. Non-Functional Requirements
5. Architecture and Stack
6. Data Model
7. Sign-In and Access Approval
8. Email Notifications
9. Visual Design System
10. Motion and Interaction Design
11. Screen Requirements
12. Responsive Design and PWA
13. Accessibility
14. Content and UX Writing
15. Reusable Components
16. Reports and Analytics
17. Testing Strategy
18. First Deploy and Seed Data
19. Integration with the Media Checklist App
20. Delivery Phases and Definition of Done
21. Open Questions

## 1. Product Summary and Goals

Church Projects Hub is a private, Jira-style work tracker where each volunteer team runs its own project. Sign-in is Google-only. Nobody sees anything until an admin approves them. It runs entirely on free tiers — $0/month at church scale — and feels like a native Apple app.

**Goals (v1)**

- Every ministry team (Media, Worship, Kids, Hospitality, Facilities, Outreach) can plan and track its own backlog without spreadsheets or group chats.
- Access is controlled: Google sign-in → request specific projects → admin approval.
- People hear about work that concerns them by email: assignments, mentions, comments, due dates.
- Leaders see progress and workload without asking for status updates.
- Volunteers can report bugs or suggest features from inside the app.

**Non-goals (v1)**

- Not a volunteer scheduler. Planning Center Services keeps that job.
- No sprints, story points, or burndown charts.
- No public/anonymous access and no native iOS/Android app. A responsive PWA covers phones.
- No time tracking, budgets, or giving data.

**Product experience vision**

The product combines Apple-inspired craftsmanship (simplicity, calm surfaces, purposeful motion), Linear-inspired efficiency (fast interactions, keyboard navigation, low friction), and Notion-inspired approachability (clear organization, helpful empty states, progressive disclosure). It must feel premium on desktop, natural on mobile, easy for a new volunteer, and efficient for frequent users. It is not a copy of any existing product — it has a distinct, consistent identity.

**Success measures (first 90 days)**

| Measure | Target |
| --- | --- |
| Teams actively using a project | Media at launch; 1 or 2 teams within 90 days |
| Access requests decided within 48 hours | 90% |
| Tasks with an assignee and due date | 75% |
| Monthly hosting cost | $0 |
| Unplanned downtime on a Sunday | None |
| New volunteer: first sign-in to first task | Under 2 minutes after approval |

## 2. Users, Roles and Permissions

Two layers of roles: one app-wide role per person, plus one role per project they belong to. **All permissions are checked on the server for every request.** Hiding a button in the UI is never the security control.

### App-wide roles

| Role | Description |
| --- | --- |
| **App Admin** | At least 2 people always (so nobody gets locked out). Creates/archives projects, appoints project admins, approves any request, manages users, edits What's New, triages feedback, sees all reports and the audit log. |
| **Member** | An approved person. Sees only their own projects. |
| **Pending** | Signed in with Google but not yet approved for any project. Sees only the request screen and their request status. |
| **Suspended** | Blocked from everything. Past work and name stay on tasks for history. |

### Project roles

| Role | Description |
| --- | --- |
| **Project Admin** | Approves/denies project requests, invites people, changes member roles, edits workflow columns, labels, and components, archives tasks. |
| **Contributor** | Creates, edits, assigns, comments, and moves tasks. |
| **Viewer** | Reads and comments only. Suited to pastors or leaders who want visibility. |

### Permission matrix

| Action | App Admin | Project Admin | Contributor | Viewer | Pending |
| --- | --- | --- | --- | --- | --- |
| See a project's tasks | All projects | Own project | Own project | Own project | No |
| Create, edit, move tasks | All | Yes | Yes | No | No |
| Comment and @mention | All | Yes | Yes | Yes | No |
| Delete a task | All | Yes | Own tasks only, within 24 hours | No | No |
| Approve access requests | All projects | Own project | No | No | No |
| Change member roles | All | Own project, not other admins | No | No | No |
| Edit workflow, labels, components | All | Own project | No | No | No |
| Create or archive projects | Yes | No | No | No | No |
| View reports | All projects | Own project | Own project | Own project | No |
| Submit bug or feature request | Yes | Yes | Yes | Yes | Yes |
| Publish What's New | Yes | No | No | No | No |
| Read audit log | Yes | No | No | No | No |
| Export audit log to CSV | Yes | No | No | No | No |
| Revoke another user's session | Yes | No | No | No | No |
| Request own data deletion | Yes | Yes | Yes | Yes | Yes |

### Safety rules

- The last App Admin cannot be demoted or suspended.
- A Project Admin cannot remove another Project Admin; only an App Admin can.
- Every role change and approval is written to the audit log with who, what, and when.
- A suspended user's active sessions are terminated immediately (within one request cycle), not at next login.
- An invited user's invite link expires after 7 days. Project admins can resend. Expired invites appear in the admin queue as "Expired — resend?"
- Every destructive action requires a confirmation screen before it runs (section 11.14). There is no undo-instead-of-confirm pattern.

## 3. Functional Requirements

Each requirement has an ID traceable to a GitHub issue and a test. Priority: **M** = must ship in v1, **S** = should ship in v1, **C** = could come later.

### Authentication and Access (AUTH)

| ID | Requirement | Priority |
| --- | --- | --- |
| AUTH-1 | Sign in with Google only. No passwords stored anywhere. | M |
| AUTH-2 | First sign-in creates a Pending user and shows the project request screen. | M |
| AUTH-3 | Pending user picks one or more projects and adds a short note. | M |
| AUTH-4 | Optional allow-list of email domains that are auto-approved as Viewer for chosen projects. | C |
| AUTH-5 | Approved members can request access to more projects later from their profile. | M |
| AUTH-6 | Sessions last 30 days, are revocable by an admin, and end immediately on suspension. | M |
| AUTH-7 | A user whose session is revoked mid-use is redirected to sign-in with the message "Your session has ended. Please sign in again." No error code shown. | M |
| AUTH-8 | A Pending user who has waited more than 48 hours with no decision sees a "Still waiting?" prompt with a one-click nudge email to the project admin. Limit: once per 24 hours per request. | S |
| AUTH-9 | An admin can invite someone by email. The invite link is pre-approved for a specific project and role, expires after 7 days, and is single-use. It can only be accepted by a Google account whose email matches the invited email (letter case ignored); otherwise the person sees the invitation-mismatch copy in section 14. Invited person skips the request queue on first sign-in. | M |
| AUTH-10 | A public home page at `/` (what the app is, who it's for, a Sign in with Google button) and a privacy policy at `/privacy`, both on the app's verified domain. Required to publish the Google sign-in for personal Gmail accounts (section 18). | M |

### Projects (PROJ)

| ID | Requirement | Priority |
| --- | --- | --- |
| PROJ-1 | App Admin creates a project with name, short key (e.g. MEDIA), colour, icon and description. | M |
| PROJ-2 | Each project has its own workflow columns. Default: Backlog, To Do, In Progress, In Review, Done. | M |
| PROJ-3 | Project Admin can rename, add, reorder and hide columns, up to 8. | S |
| PROJ-4 | Projects can be archived (read-only) and restored. Never hard-deleted from the UI. | M |
| PROJ-5 | Project overview page shows description, members, admins, and open task counts. | M |
| PROJ-6 | App Admins can mark a project Hidden (invite-only). Hidden projects do not appear on the request screen; access is by invite link only. The project name still appears in the audit log. | M |
| PROJ-7 | The built-in "Hub Feedback" project is created automatically on first deploy, with App Admins as its admins. It cannot be archived or deleted. It is a system project: hidden from the request screen and visible only to App Admins, so Media is the only team project at launch. If it doesn't exist, the first App Admin login re-creates it. | M |

### Tasks (TASK)

| ID | Requirement | Priority |
| --- | --- | --- |
| TASK-1 | Task fields: key (MEDIA-42), title, rich-text description, type (Task, Bug, Idea, Epic), status, priority (Urgent, High, Medium, Low), assignee, reporter, due date, labels, component, parent epic. | M |
| TASK-2 | Board view with drag and drop between columns, and list view with sort and filter. | M |
| TASK-3 | Subtasks as a checklist inside a task, with progress shown on the card. | M |
| TASK-4 | Comments with @mentions and markdown. Edits show "edited". | M |
| TASK-5 | Attachments up to 10 MB each (images, PDFs). | S |
| TASK-6 | Activity history on every task: who changed what, when. | M |
| TASK-7 | Scope marker: each task is In scope, Out of scope, or Parked, with a filter for each. | M |
| TASK-8 | Watchers: anyone can follow a task to get its notifications. | S |
| TASK-9 | Links between tasks: blocks, is blocked by, relates to. | C |
| TASK-10 | Bulk edit: select several tasks, change assignee, status, labels or due date. | S |
| TASK-11 | Recurring tasks (e.g. "replace mic batteries" every Sunday). | C |
| TASK-12 | On a phone, a task row can be swiped right to mark complete, or swiped left to reassign. Tap targets and swipe gesture are both supported; neither replaces the other. | S |
| TASK-13 | A task opened offline shows its cached last-known state read-only with an offline banner. No edits possible offline in v1. | S |

### Organisation (ORG)

| ID | Requirement | Priority |
| --- | --- | --- |
| ORG-1 | Labels (tags) per project, with colour. Project Admin manages them. | M |
| ORG-2 | Components per project (e.g. Audio, Lighting, Stage). | S |
| ORG-3 | Epics group related tasks with a progress bar. | S |
| ORG-4 | Milestones tied to events (e.g. "Easter 2027") with a target date. | S |
| ORG-5 | Saved filters, private or shared to the project. | S |

### Search and Navigation (NAV)

| ID | Requirement | Priority |
| --- | --- | --- |
| NAV-1 | Global search across tasks the user can see, by key, title, description and comments. Uses a SQLite FTS5 index (section 6); results filtered to the user's projects in the same query. | M |
| NAV-2 | Command palette (Cmd+K / Ctrl+K) to jump to projects, tasks, and actions. | S |
| NAV-3 | "My Work" home page: assigned to me, due soon, mentioned me, across all my projects. | M |
| NAV-4 | Keyboard shortcuts: C new task, / search, J/K move, E edit. | C |

### Notifications (NOTIF)

| ID | Requirement | Priority |
| --- | --- | --- |
| NOTIF-1 | Email on: task assigned to me, @mention, comment on a task I own or watch, status change on my task. | M |
| NOTIF-2 | Email reminder 7 days and 1 day before a due date, and a note when overdue. | M |
| NOTIF-3 | Email to project admins on new access request; email to requester on decision. | M |
| NOTIF-4 | In-app notification bell with unread count. See section 11.8 for the bell behavior and refresh rules. | M |
| NOTIF-5 | Per-person settings: each event on or off, instant or daily digest. | S |
| NOTIF-6 | One-click unsubscribe link in every email. | M |

### Reports (RPT)

| ID | Requirement | Priority |
| --- | --- | --- |
| RPT-1 | Project dashboard: open by status, by assignee, overdue, created vs completed per week. | M |
| RPT-2 | Workload view: open tasks per person across projects (App Admin) or per project. | S |
| RPT-3 | Cycle time: median days from In Progress to Done. | S |
| RPT-4 | Export any list or report to CSV. | S |

### Feedback and Product (FDBK)

| ID | Requirement | Priority |
| --- | --- | --- |
| FDBK-1 | What's New page with dated release notes; a dot on the menu when there's something unread. See section 11.9 for the page spec. | M |
| FDBK-2 | Report a Bug form: what happened, what you expected, optional screenshot; browser and page captured automatically. | M |
| FDBK-3 | Request a Feature form with title, description and why it matters. | M |
| FDBK-4 | Bugs and requests land as tasks in the built-in "Hub Feedback" project owned by App Admins. | M |
| FDBK-5 | Submitter is emailed when their item's status changes. | S |
| FDBK-6 | Members can upvote feature requests. | C |

### Administration (ADM)

| ID | Requirement | Priority |
| --- | --- | --- |
| ADM-1 | Access request queue with approve, deny with reason, and role picker. | M |
| ADM-2 | User directory: search, view projects and roles, suspend, restore. Shows each user's email so admins can spot duplicate accounts. | M |
| ADM-3 | Audit log of the events listed in section 6, searchable, kept 1 year, exportable to CSV. | M |
| ADM-4 | Usage panel showing free-tier consumption: Worker requests, D1 rows read and written, DB size (from the Cloudflare analytics API), and emails sent today (from `email_outbox`). | S |
| ADM-5 | At 80% of any free-tier daily limit, App Admins get a warning email and see a banner in the usage panel. At 100%, the panel shows which limit was hit and when. | M |
| ADM-6 | A user can submit a data deletion request from profile settings. App Admins see it in the admin panel and approve it. On approval: name, email, avatar and Google sub are replaced with "Deleted User \[ID\]"; tasks remain with that placeholder; audit log entry for the deletion is kept. Turnaround target: 30 days. | S |
| ADM-7 | Invite management: App Admins and Project Admins see outstanding invites (recipient email, role, expiry, sender), can cancel unused invites, and resend expired ones. | S |
| ADM-8 | Retention purge: the daily job lists archived projects and suspended users that passed 6 months in an "Eligible for deletion" queue. Nothing is deleted automatically; an App Admin reviews and confirms each purge (section 11.14). Purges are audit-logged. | S |

### Rate Limit Responses (RATE)

| ID | Requirement | Priority |
| --- | --- | --- |
| RATE-1 | Sign-in rate limit hit (more than 30 sign-in attempts in a minute from one IP, NFR-4): "Too many sign-in attempts. Please wait a minute and try again." No error code. | M |
| RATE-2 | Access request limit hit (5/day): "You've submitted the maximum requests for today. Check back tomorrow, or contact an admin directly." Each project requested counts as one request; the day is the calendar day in the user's timezone. A submission that would go over the limit is rejected whole. | M |
| RATE-3 | Feedback limit hit (20/day): "You've sent a lot of feedback today — thank you! You can submit more tomorrow." | M |

## 4. Non-Functional Requirements

| ID | Area | Requirement |
| --- | --- | --- |
| NFR-1 | Security | Authorization checked in the API on every request, against the user's project role. |
| NFR-2 | Security | Sessions use HttpOnly, Secure, SameSite=Lax cookies. CSRF token on every write. OAuth uses PKCE; validates Google ID token signature, audience, and expiry. |
| NFR-3 | Security | All input validated with shared Zod schemas on client and server. All SQL is parameterized. Rich text is stored as validated Tiptap JSON, never HTML (section 11.5). |
| NFR-4 | Security | Rate limits: 30 sign-in attempts/min/IP, 5 access requests/day/user, 20 feedback submissions/day/user. A sign-in attempt is counted when sign-in starts (the redirect to Google), not again on the return; the limit is set for many volunteers signing in at once behind one church Wi-Fi IP. When the limit is hit, a "sign-in rate limit hit" audit event is written at most once per IP per minute. The per-IP sign-in limit uses the Workers rate-limiting binding if the free plan offers it, otherwise a small D1 counter keyed by IP hash and minute; per-user daily limits count existing rows (`access_requests`, feedback tasks). |
| NFR-5 | Privacy | Store only name, email, and Google avatar URL. No personal data in logs. See ADM-6 for the deletion process. |
| NFR-6 | Reliability | 99.5% monthly availability. No deploys between Saturday 6 pm and Sunday 2 pm. |
| NFR-7 | Reliability | CI required: type check, unit tests, API tests, then preview deploy. Main branch deploys to production; one-click rollback available. |
| NFR-8 | Reliability | Two restore paths: (1) Nightly full database export to R2, retained 30 days, run by a scheduled GitHub Actions job at 3 am Winnipeg time (an export briefly blocks the database) — use this to restore to any specific day. (2) D1 Time Travel point-in-time restore for the last 7 days (free-plan limit; 30 days on Workers Paid) — use this for quick recovery of recent accidental changes. Restore process tested quarterly. |
| NFR-9 | Reliability | Emails go through a queue with retries (3 attempts, backoff). A failed email never fails the user's action. |
| NFR-10 | Integrity | Optimistic concurrency via version number per task. Concurrent edits show "This task changed — review before saving." Never silent overwrite. |
| NFR-11 | Performance | Board loads under 1.5 s on a mid-range phone on 4G for a project with 500 tasks. API p95 under 300 ms. |
| NFR-12 | Performance | Card moves are optimistic — roll back with a message if the server rejects it. |
| NFR-13 | Accessibility | WCAG 2.2 AA: 4.5:1 text contrast, full keyboard use including drag-and-drop alternatives, visible focus, screen reader labels, respects `prefers-reduced-motion`. |
| NFR-14 | Compatibility | Latest 2 versions of Safari (iOS + macOS), Chrome, Edge, Firefox. Works from 360 px wide. Installable as a PWA. |
| NFR-15 | Observability | Structured error logging with request IDs. App Admins get an email if errors exceed 20 in an hour. |
| NFR-16 | Cost | Worker requests and D1 stay inside free-tier limits with at least 5x headroom at 50 users and 3x at 150 users, Hub and checklist app combined (budget in section 5). Email stays under the 300/day cap through cap protection; switch provider at about 100 active users. Usage panel warns at 80%. |
| NFR-17 | Maintainability | One TypeScript codebase, one repo. Documented setup in under 15 minutes for a new volunteer developer. |
| NFR-18 | Reliability | If D1 is unavailable: show a maintenance page — "The hub is temporarily unavailable. We're aware and working on it." No stack traces. |
| NFR-19 | Reliability | If Resend is unavailable, in-app notifications still work. Email delivery resumes automatically on recovery. |
| NFR-20 | PWA / Offline | App shell, My Work, and task pages visited in the last session are cached by the service worker and available offline. Cached content shows a persistent amber banner. All writes disabled offline in v1. |
| NFR-21 | PWA / Offline | PWA manifest: name, short name, icons (192 px + 512 px), theme colour matching project accent, `display: standalone`. Add-to-home-screen prompt shown once after the user's second login. |
| NFR-22 | Performance | Every Worker request and cron run stays within the free plan's 10 ms CPU limit. Heavy work is done in SQL (D1 time doesn't count as Worker CPU) or split into batches; CSV exports stream rows and cap at 5,000 rows per file. |
| NFR-23 | Cost | Write discipline: `users.last_seen_at` and session activity are updated at most once every 15 minutes per user, never on every request. |
| NFR-24 | Data safety | No children's personal details (names with ages, medical, allergy, custody or contact information) and no confidential pastoral information in tasks, comments or attachments. Shown as a one-line notice under the description field and in the privacy policy. |

## 5. Architecture and Stack

One TypeScript Cloudflare Worker with a D1 database. One deployable unit: one place to deploy, roll back, and read logs.

&#91;embedded content: system architecture · 1 Worker, 1 database, 3 outside services\]

The browser only talks to the Worker. The Worker alone holds secrets, checks roles, and touches the database. Scheduled jobs run in the same codebase on a timer.

### Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Hosting and API | Cloudflare Workers + Hono | Fast globally, no servers to patch, church already has the account. |
| Front end | React + TypeScript + Vite, served as Workers static assets | One deploy for app and API; no cross-origin cookie problems. Static asset requests are free and don't count as Worker requests. |
| Database | Cloudflare D1 (SQLite) + Drizzle ORM + versioned migrations | Relational with transactions; migrations are code-reviewed and repeatable. |
| Search | SQLite FTS5 virtual table in D1 | Full-text search with no extra service (NAV-1). |
| Files | Cloudflare R2, served through the Worker | Attachments, no egress fees. The Worker checks project membership, then streams the file — no signed URLs or R2 access keys needed. |
| Backups | Scheduled GitHub Actions job: `wrangler d1 export` → R2 | Uses no Worker CPU or cron slot; secrets live in GitHub. |
| Sign-in | Google OAuth 2.0 (openid, email, profile) with PKCE | Basic scopes avoid Google's sensitive-scope verification. |
| Email | Resend (transactional email API), behind an `EmailSender` interface | Free plan: 100 emails/day, 3,000/month; swappable if limits are hit. |
| Scheduling | Cloudflare Cron Triggers — one schedule, every 5 minutes | The free plan allows 5 cron schedules per account, shared with the checklist app. One handler dispatches: outbox every run, digests and report snapshots at the top of each hour, daily jobs (retention queue, orphaned-file cleanup, invite expiry) at 3 am Winnipeg time. |
| Validation | Zod schemas shared by client and server | One source of truth for every field rule. |
| Testing | Vitest (unit + API), Playwright (end to end) | Covers permissions, approval flow, and board interactions. |
| CI/CD | GitHub + GitHub Actions | Tests on every PR; preview deploy per branch; main → production. |
| Errors | Workers logs + small error table + alert email | Free and sufficient at this scale. |
| Service worker | Workbox (via Vite PWA plugin) | Offline caching (NFR-20). |
| UI components | Radix UI primitives | Accessible menus, dialogs, popovers — correct behavior by default. |
| Drag and drop | dnd-kit | Accessible drag-and-drop with keyboard alternative. |
| Data fetching | TanStack Query | Caching, optimistic updates, and rollback. |
| Styling | Tailwind CSS | Design tokens, responsive layout, consistent spacing. |
| Rich text | Tiptap (ProseMirror-based), stored as JSON | Extensible and accessible; JSON storage removes HTML sanitizing from the Worker. See section 11.5. |

### Free-tier budget

On its busiest day (Sunday), the Hub plus the checklist app uses about 11% of the tightest Cloudflare limit at launch and 34% at the 150-user ceiling. Email is the first limit to bind as the app grows. Limits are per Cloudflare account and reset at midnight UTC.

**Assumptions (Sunday)**

| Input | Value |
| --- | --- |
| Active users | 25 at launch (Media), 50 mid-term, 150 ceiling |
| Worker requests per active user | 150 from page views and actions, plus 30 bell refreshes (every 2 min for about 1 hour of visible use) |
| Pending-screen polling | 5 pending users × 30 minutes at one poll per 30 s = 300 requests |
| Cron runs | 288 (every 5 minutes) |
| Checklist app | 30 volunteers × 200 requests = 6,000 requests, 50,000 rows read, 2,000 rows written on its busiest day (used 1–3 days a week; Sunday assumed shared) |
| D1 rows read per active user | 5 board loads (200–600 rows each, by board size) + 145 other requests × 20 rows + 30 bell checks × 5 rows |
| D1 rows written per active user | 20 actions × 6 rows (task, history, outbox, notification, index entries — D1 counts each index update as a row) + throttled activity updates |
| Emails per active user | 1.5 instant + a digest for 60% of users |

**Daily use against free limits**

| Free limit per day | Launch (25 users) | 50 users | Ceiling (150 users) |
| --- | --- | --- | --- |
| Worker requests (100,000) | 11,100 (11%) | 15,600 (16%) | 33,600 (34%) |
| D1 rows read (5,000,000) | 250,000 (5%) | 450,000 (9%) | 1,310,000 (26%) |
| D1 rows written (100,000) | 7,100 (7%) | 10,300 (10%) | 23,300 (23%) |
| Emails, Resend free (100) | 55 (55%) | 105 (over the cap) | 315 (over the cap) |

**Rules that keep it in budget** (each is a requirement):

- The bell refreshes every 2 minutes only while the tab is visible, plus on tab focus; every API response also carries the unread count.
- The pending screen polls only while visible and stops once every request is decided.
- `last_seen_at` is written at most every 15 minutes (NFR-23). Writing it on every request would add about 54,000 rows written a day at 150 users.
- Report snapshots are incremental: each hourly run reads only `task_events` since the last run. Recomputing everything hourly would add about 480,000 rows read a day at the ceiling.
- Backups run from GitHub Actions, not the Worker.
- Static assets are never routed through the Worker (no global `run_worker_first`).
- At about 40 active users, switch `EmailSender` to Workspace Gmail or a paid Resend plan; until then, cap protection (section 8) keeps sending under 100 a day (and the 3,000 a month that follows from it).

## 6. Data Model

All tables carry `created_at`, `updated_at`, `created_by`. Tasks, comments, and projects are soft-deleted with `deleted_at`.

**Retention:** archived projects and suspended users' details become eligible for full deletion after 6 months. They are queued for an App Admin to confirm (ADM-8), never deleted automatically.

| Table | Key columns | Notes |
| --- | --- | --- |
| users | id, google\_sub (unique), email, name, avatar\_url, app\_role, status, timezone, last\_seen\_at, deleted\_at, deletion\_requested\_at | `google_sub` is Google's stable ID. `email`, `name` and `avatar_url` are refreshed from Google on every sign-in. status = pending, active, suspended. `last_seen_at` written at most every 15 min. |
| sessions | id (random 256-bit), user\_id, expires\_at, ip\_hash, user\_agent, revoked\_at | `revoked_at` enables immediate mid-session revocation. |
| projects | id, key, name, description, colour, icon, archived\_at, next\_task\_number, hidden | `hidden` = invite-only (PROJ-6). `next_task_number` increments in the same transaction as task insert — keys never collide. |
| project\_members | project\_id, user\_id, role, added\_by | role = admin, contributor, viewer. PK (project\_id, user\_id). |
| access\_requests | id, user\_id, project\_id, note, status, decided\_by, decided\_at, decision\_reason | status = pending, approved, denied, withdrawn. One open request per user per project. |
| invites | id, project\_id, role, email, invited\_by, token (unique), expires\_at, used\_at | Token = random 256-bit. Single-use. Expires after 7 days. |
| workflow\_states | id, project\_id, name, category, position | category = todo, in\_progress, done. Reports use category so renamed columns don't break charts. |
| tasks | id, project\_id, number, title, description\_json, description\_text, type, state\_id, priority, scope, assignee\_id, reporter\_id, due\_date, epic\_id, milestone\_id, rank, version | `description_json` = Tiptap document; `description_text` = plain-text copy for search and emails. `due_date` = calendar date (YYYY-MM-DD), no time. `rank` = fractional string. `version` = optimistic concurrency. |
| tasks\_fts | FTS5 virtual table: task\_id, project\_id, key, title, body | Kept in sync on task and comment writes; `body` = description plus comment text. Searched with `MATCH` joined to the user's project list. |
| subtasks | id, task\_id, title, done, position | Lightweight checklist items. |
| labels / task\_labels | id, project\_id, name, colour / task\_id, label\_id | Per project. |
| components | id, project\_id, name, lead\_id | Optional grouping (Audio, Lighting, etc.). |
| milestones | id, project\_id, name, target\_date, released\_at | Tie work to events. |
| comments | id, task\_id, author\_id, body\_json, body\_text, edited\_at, deleted\_at | Mentions parsed from the JSON into a `mentions` table on save. |
| attachments | id, task\_id, r2\_key, filename, mime, bytes, uploaded\_by, deleted\_at | Files in R2; DB holds the pointer only. Downloaded through the Worker after a membership check. |
| watchers | task\_id, user\_id | Assignee and reporter added automatically. |
| task\_events | id, task\_id, actor\_id, field, old\_value, new\_value, at | Powers task history and all reports. |
| notifications | id, user\_id, type, task\_id, payload\_json, read\_at | In-app bell. |
| email\_outbox | id, user\_id, template, payload\_json, dedupe\_key, status, attempts, send\_after, sent\_at, last\_error | Written in the same transaction as the triggering action. `dedupe_key` stops duplicates. |
| notification\_prefs | user\_id, event\_type, channel, mode | mode = instant, digest, off. |
| saved\_filters | id, project\_id, owner\_id, name, query\_json, shared |  |
| releases\_news | id, title, body\_md, published\_at | What's New (admin-written Markdown, rendered with raw HTML disabled). `user_news_seen` stores the last item each person read. |
| report\_snapshots | project\_id, period, metrics\_json, last\_event\_id | Hourly incremental aggregates; `last_event_id` marks where the next run starts. |
| audit\_log | id, actor\_id, action, target\_type, target\_id, detail\_json, ip\_hash, at | Append-only. Kept 1 year. Events listed below. |
| data\_deletion\_requests | id, user\_id, requested\_at, decided\_by, decided\_at, status | status = pending, approved, rejected, completed. |

**Required indexes:** tasks (project\_id, state\_id, rank), tasks (assignee\_id, due\_date), task\_events (task\_id, at), email\_outbox (status, send\_after), access\_requests (project\_id, status), invites (token), invites (project\_id, used\_at), notifications (user\_id, read\_at), plus the `tasks_fts` FTS5 index.

### Audit log events

Every event records actor, target, time and IP hash.

| Area | Events |
| --- | --- |
| Sign-in and sessions | First sign-in (Pending user created), session revoked, sign-in rate limit hit |
| Access | Request submitted, approved (with role), denied (with reason), withdrawn; invite sent, used, cancelled, resent, expired |
| Users | App role changed, suspended, restored, data deletion requested, approved, completed |
| Projects | Created, edited, archived, restored, hidden flag changed, member added, removed, role changed |
| Workflow | Columns, labels or components changed |
| Destructive actions | Task, comment or attachment deleted; retention purge confirmed |
| Content | What's New post published or edited |
| System | Free-tier warning sent; usage limit reached; restore performed |

## 7. Sign-In and Access Approval

Signing in alone grants nothing beyond a request screen. Google proves identity; an admin decides access.

&#91;embedded content: sign-in and access approval, 6 steps and 2 decisions\]

### Sign-in mechanics

1. Worker redirects to Google with a random `state` value and a PKCE code challenge, stored in a short-lived cookie.
2. On return, Worker exchanges the code and verifies the ID token: signature, issuer, audience, expiry, and that email is verified.
3. User is matched by `google_sub` (stable), not email. New person becomes a Pending user. Email, name and photo are refreshed from Google on every sign-in.
4. A server-side session is created and set as an HttpOnly cookie. The `revoked_at` check runs on every authenticated API call — suspended or revoked users lose access within one request cycle.

### Approval rules

- A request can name several projects. Each project's admins decide independently.
- Any one admin of the project can approve. If no project admin exists, App Admins receive the request.
- Default role: Contributor. Admin can choose Viewer or Project Admin instead.
- Denials require a short reason — emailed to the requester.
- Requests pending after 3 days trigger one reminder email to all current App Admins. Recipients are resolved at send time from active users with the App Admin role — no hardcoded addresses.
- Invite links (AUTH-9) are pre-approved; invited person skips the queue on first sign-in. Expire after 7 days, single-use.
- Every decision is written to the audit log.
- Duplicate accounts: each Google account is a separate user, and accounts are not merged in v1. The sign-in page says "Use the same Google account each time." Admins see each user's email in the directory (ADM-2) and can suspend an unwanted duplicate.

### Pending user experience

After submitting a request, the user lands on a live status screen:

- Their Google name and photo.
- Each requested project with a status chip: Pending / Approved / Denied.
- Message: *"A team admin will review your request. We aim to respond within 48 hours."*
- Status polls every 30 seconds — no manual refresh.
- After 48 hours with no decision: show "Still waiting? Send a reminder to the project admin." Rate-limited to once per 24 hours per request.
- If denied: show the denial reason under the project chip. Option to request a different project or contact an admin.

## 8. Email Notifications

Resend free plan: 100 emails/day, 3,000/month. Urgent events go instantly; everything else goes into a morning digest.

### Event table

| Event | Recipients | Default mode |
| --- | --- | --- |
| Task assigned to you | New assignee | Instant |
| @mention | Mentioned person | Instant |
| New access request | Project admins (App Admins if none) | Instant |
| Access request approved or denied | Requester | Instant |
| Session revoked by an admin | Affected user | Instant |
| Invite link sent | Invited person | Instant |
| Free-tier limit at 80% | All current App Admins (queried from DB) | Instant |
| Due in 7 days | Assignee | Morning digest |
| Due tomorrow | Assignee | Morning digest |
| Overdue (once, the day after) | Assignee + project admins | Morning digest |
| Comment on a task you own or watch | Assignee, reporter, watchers | Morning digest |
| Status change on your task | Reporter | Morning digest |
| Bug or feature request changed status | Submitter | Morning digest |
| Weekly project summary | Project admins | Monday morning, opt-in |

### Sending mechanics

1. Every triggering action writes to `email_outbox` **in the same database transaction** as the action itself. No transaction = no email row; committed transaction = email is guaranteed to be attempted.
2. Scheduled worker runs every 5 minutes, sends due rows. Failures retry at 5, 30, 120 minutes, then park as failed (visible in admin panel).
3. Digest worker runs hourly. Builds digests for anyone whose local time is 7 am. Default timezone: America/Winnipeg; users can change theirs.
4. `dedupe_key` (e.g. `due7:MEDIA-42:2026-11-01`) prevents duplicate reminders even if the job reruns.
5. The actor never emails themselves.
6. All admin-targeted events (access request reminders, free-tier alerts, error alerts) resolve recipients at send time by querying `users` where `app_role = 'admin'` and `status = 'active'`. Adding or removing an App Admin in the app takes effect immediately for all system emails — no config change needed.

### Cap protection

- Per-person cap: 6 instant emails/day. Beyond that, excess falls into the next digest.
- At 80 emails sent in a day (80% of the 100 cap), all remaining instant emails switch to digest — except access-request emails.
- If the church outgrows the cap: swap the `EmailSender` interface to the church's Google Workspace Gmail (about 2,000 emails/day per sending account) or move to a paid Resend plan (50,000/month, no daily cap). Config change only.

### Email design

- Plain, Apple-style layout: church logo, one-line subject ("Sam assigned you MEDIA-42: Replace stage left DI box"), task title, due date, project, one button to open it.
- Footer: link to notification settings + one-click unsubscribe for that event type.
- Sent from `media@ifcwpg.com` (`EMAIL_FROM`). Replies go to that Workspace mailbox.

### Domain verification for Resend

Resend sends as ifcwpg.com once the domain is verified in the Resend dashboard (Domains → Add domain). Verification is per domain, not per address, and it doesn't change how Google Workspace mail is sent: Resend's SPF and bounce records sit on a `send.` subdomain.

| DNS record on ifcwpg.com | Purpose |
| --- | --- |
| DKIM (TXT at `resend._domainkey`) | Signs Resend mail so it passes DMARC |
| SPF (MX and TXT at `send.ifcwpg.com`) | Return path for bounces; aligns SPF on the subdomain |
| DMARC (one TXT) | The domain must have exactly one DMARC record. If one exists, keep it rather than creating a second. |

The root domain's SPF record doesn't change. Keep Workspace's existing SPF and DKIM records as they are. Copy the exact values from the Resend dashboard, and check it shows the domain as verified before the first send.

## 9. Visual Design System

Build a unified design system using design tokens — no scattered hardcoded values.

### Design principles

1. **Clarity before decoration.** Every screen makes location, actions, and important information apparent.
2. **Common actions are fast.** Finding a task, changing status, assigning, commenting — minimal navigation, immediate feedback.
3. **Progressive disclosure.** Essential information first. Advanced controls discoverable without overwhelming everyday users.
4. **Consistency builds confidence.** Shared controls, terminology, spacing, status colors, icons, and error behavior across the entire app.
5. **Communicate state always.** Loading, saving, saved, empty, offline, disabled, permission-denied, conflict, and error states must all be distinguishable.
6. **Accessibility is a baseline.** Designed in from the start, not added at the end.
7. **Delight serves the task.** Animation, emoji, and celebration must reinforce meaning. Never slow down work or trivialize serious events.

### Token system

| Token group | Contents |
| --- | --- |
| Color | Surface hierarchy, text, borders, semantic status (overdue, due-soon, done), project accent, error, success, warning, disabled |
| Typography | Font family, scale, weights, line heights |
| Spacing | Base unit + all derived steps |
| Corner radii | Per component type |
| Elevation | Shadow and blur levels |
| Focus rings | Color, width, offset per theme |
| Motion | Durations, easing curves, reduced-motion overrides |
| Touch targets | Minimum sizes |

### Reference values

**Typography**

| Role | Size | Weight |
| --- | --- | --- |
| Large title | 34 px | 600 |
| Title | 22 px | 600 |
| Body | 17 px | 400 |
| Secondary | 15 px | 400 |
| Caption / metadata | 13 px | 400 |
| Label / badge | 12 px | 500 |

Font stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif`

Use tabular numerals for dates, counts, and metric comparisons.

**Spacing** — base unit 4 px. Steps: 4, 8, 12, 16, 20, 24, 32, 40, 48 px. Component padding: 16 px. Group separation: 24 px.

**Corner radii**

| Component | Radius |
| --- | --- |
| Cards | 12 px |
| Buttons and inputs | 10 px |
| Sheets and drawers | 20 px: top corners only on bottom sheets (mobile); the two inner (left) corners only on right-hand side sheets, square against the screen edge |
| Badges and chips | 6 px |

**Motion durations**

| Interaction | Duration |
| --- | --- |
| Micro-feedback (button, checkbox) | 100–160 ms |
| Menus, tabs, filter chips | 180–260 ms |
| Sheets, drawers, task panels | 240–360 ms |
| Celebration | 400–800 ms |

Easing: gentle spring or ease-out. Avoid linear or ease-in for visible transitions.

### Themes

Support **Light**, **Dark**, and **System** (follows OS preference). Deliberately design both themes — dark is not an inversion of light. Persist the user's choice. Theme changes apply without flashes, layout shifts, or loss of current work. Status is never conveyed by color alone — always pair with a text label or icon.

**Semantic color roles** (defined as tokens):

| Role | Light | Dark |
| --- | --- | --- |
| Surface primary | White | Near-black neutral |
| Surface secondary | Light grey | Dark neutral |
| Surface elevated | White + subtle shadow | Slightly lighter neutral |
| Text primary | High-contrast dark | High-contrast light |
| Text secondary | Medium grey | Medium light grey |
| Border | Light grey | Dark grey |
| Overdue | Red family | Red family (dark-adjusted) |
| Due soon | Amber/orange | Amber/orange (dark-adjusted) |
| Done | Green | Green (dark-adjusted) |
| Project accent | Configured per project | Same, opacity-adjusted |
| Focus ring | Blue or accent, 2 px + 2 px offset | Same |

### Icons and emoji

**Icons:** Single family (Lucide or Phosphor), 20 px, 1.5 px stroke. No mixing families. Icon-only controls must have accessible names and tooltips.

**Emoji — permitted:** friendly welcome messages, empty states, project identity tiles, low-stakes milestone celebrations.

**Emoji — prohibited:** core navigation, security warnings, access-denial messages, administrative actions, or as the only indicator of status.

Ministry identity suggestions (admins configure their own):

| Team | Suggested |
| --- | --- |
| Media | 🎥 |
| Worship | 🎵 |
| Kids | 🧒 |
| Hospitality | 🤝 |
| Facilities | 🏠 |
| Outreach | 🌍 |

## 10. Motion and Interaction Design

Build a reusable motion system — not scattered animations. Every animation has a purpose.

### Motion rules

- Use the duration ranges in section 9.
- Prefer `transform` and `opacity` transitions.
- Never block user input while animations run.
- Never animate a save confirmation before the server confirms the operation.
- For optimistic UI: show a clear failure message and recovery path when the server rejects a change.
- Drag-and-drop feedback must clearly show source, target, and resulting placement.
- Success celebrations: rare, brief, dismissible, proportionate to the achievement.
- Avoid continuous decorative movement, excessive parallax, and large-area effects that harm performance.

### Reduced motion

When `prefers-reduced-motion` is enabled: remove or simplify nonessential transitions without losing state information. Essential state changes (save, error, offline) use instant visual changes rather than transitions.

### Interaction feedback

Every actionable control must have: hover, focus, pressed, disabled, loading, success, and error states. Touch interfaces must not depend on hover to reveal essential actions. Destructive actions are visually distinct from routine ones.

## 11. Screen Requirements

All screens implement the acceptance criteria listed in section 20.

### 11.1 My Work dashboard

The user's personal starting point — the first screen after an approved sign-in.

- Sections in order: Overdue → This week → Later → Mentions strip (if unread).
- Welcome message: *"Good morning 👋 Here's what needs your attention this week."* The greeting follows the time of day in the user's timezone: "Good morning" before noon, "Good afternoon" until 5 pm, then "Good evening".
- All dates in the user's configured timezone.
- No decorative metrics or redundant cards.
- Empty (no tasks assigned): *"You're all caught up. Check the board for work you can pick up."*
- Empty (no projects): *"You haven't been added to any projects yet."* + link to request screen.

### 11.2 Project board

- Task cards show: key, title, assignee avatar, due date, priority indicator, at most 2 label chips.
- Column header shows an open-task count.
- Filter bar chips: Assignee, Label, Priority, Scope. Active filters visually distinct.
- Board preserves scroll position and active filters when a task detail opens and closes.
- Optimistic card moves roll back with: *"Couldn't move this task. The board has been restored."*
- Keyboard-accessible alternative to drag-and-drop required (e.g. a "Move" button that opens a column picker).
- On mobile (< 768 px): columns scroll horizontally; one column visible by default; swipe between columns.

### 11.3 Task details

- On ≥ 768 px: sheet overlaying the board. Closing restores focus to the card.
- On < 768 px: full-screen view. Back button and swipe-down return to the board.
- Layout: title → left panel (description, subtasks, comments, activity) → right panel / below (status, assignee, due date, priority, labels, scope, epic, milestone).
- Inline editing — no "Edit mode." Auto-save with *"Saved ✓"* confirmation.
- Conflict state: *"This task was updated by someone else. Review the changes before saving yours."*
- Empty description: *"Add a description."* — tap to start editing.
- Overdue date = red. Due soon (within 7 days) = amber.
- Due dates are calendar dates with no time. A task is due soon from 7 days before its due date, and overdue from 00:00 the day after its due date, in the viewer's timezone. Reminder emails use the assignee's timezone.

### 11.4 File attachments (TASK-5)

- File picker button and drag-and-drop zone on the task detail.
- Accepted: images (jpeg, png, gif, webp) and PDF. Max 10 MB per file. The Worker checks the file's type from its first bytes, not only its name.
- While uploading: progress bar with filename and percentage. Upload button disabled during upload.
- On success: thumbnail (images) or PDF icon with filename and size. Click opens it in a new tab from `/api/attachments/:id`, which checks the viewer's project membership and streams the file from R2. No signed URLs.
- On failure: error state with *"Upload failed. Try again."* and retry button. Does not block other actions.
- Deleting: confirmation screen first (section 11.14). On confirm, soft-delete the DB row, then delete the R2 object (R2 and D1 cannot share a transaction); the daily job removes any orphaned R2 objects.
- Validation before upload: *"This file is too large. Maximum size is 10 MB."* / *"Only images and PDFs are supported."*
- Under the upload zone: *"Don't upload children's details or confidential pastoral information."* (NFR-24)

### 11.5 Rich text editor (task descriptions and comments)

Editor: **Tiptap** (ProseMirror-based, React integration).

**Task descriptions** support: bold, italic, underline, strikethrough, headings (H2, H3), bullet list, numbered list, block quote, code (inline and fenced), horizontal rule, link, @mention.

**Comments** support: bold, italic, inline code, links, @mentions, bullet lists only. No headings or fenced code blocks.

**Accessibility:**

- Toolbar is keyboard-accessible (Tab to reach, arrow keys to move between tools).
- Editing area has `role="textbox"` and `aria-multiline="true"`.
- @mention suggestions use a listbox with `aria-activedescendant`.

**@mention behavior:** typing `@` opens a suggestion popover. Fuzzy-filter as user types. Select with Enter or click. Mention renders as a styled chip. Saved to `mentions` table on submit, which triggers notification emails.

**Storage and safety:** descriptions and comments are stored as Tiptap JSON (`description_json`, `body_json`), never as HTML. The server validates the JSON with a Zod schema that allows only the node and mark types listed above, rejects links that aren't `http`, `https` or `mailto`, and writes a plain-text copy (`description_text`, `body_text`) for search and emails. The client renders the JSON with Tiptap, so no raw HTML is ever inserted into the page and no server-side HTML sanitizer is needed. Under the description field: *"Don't include children's details or confidential pastoral information."* (NFR-24)

### 11.6 Request access and pending experience

- Sign-in: Google sign-in button, church logo, one sentence explaining the app.
- Project selection: grid of visible project tiles (hidden projects do not appear). Multi-select; optional short note; single "Request access" button.
- Pending screen: user's Google name and photo; status chips per project (Pending / Approved / Denied); polls every 30 seconds while visible, and stops once every request is decided.
- After 48 hours: *"Still waiting? Send a reminder to the project admin."* Once per 24 hours.
- Denial: reason shown under the project chip. Option to request a different project.
- Invited user: skip request screen; land on *"You've been invited to \[Project\] as \[Role\]. Sign in with Google to accept."*
- Sign-in page shows *"Use the same Google account each time."* and links to the privacy policy.

### 11.7 Security-state screens

**No app navigation or task content on any of these screens.**

**Suspended:** *"Your access has been suspended. If you think this is an error, contact an app administrator."* Show media@ifcwpg.com as the contact email. No emoji.

**Session ended/revoked:** redirect to sign-in. Single line: *"Your session has ended. Please sign in again."* No error code.

**Expired invitation:** *"This invitation has expired. Contact the project admin to request a new one."*

### 11.8 Notification bell (NOTIF-4)

- Bell icon in app header with unread count badge (max "99+").
- Clicking opens a dropdown panel (not a new page).
- Shows 20 most recent notifications, newest first.
- Each notification: avatar, short description, relative time, link to item.
- Unread notifications have a blue dot. Clicking marks it read and navigates.
- "Mark all as read" button at top.
- "View all" link at bottom → full paginated notifications page.
- Notifications older than 30 days not shown in dropdown (shown on full page).
- Empty state: *"You're all caught up."*
- Refresh rules: every API response carries the unread count in a response header; the bell also refreshes on tab focus and every 2 minutes while the tab is visible. No polling while hidden (section 5 budget).

### 11.9 What's New (FDBK-1)

- Dated release notes in reverse chronological order.
- Each entry: date, bold title, body (supports bold, links, bullet lists).
- App Admins see a "New post" button with a simple markdown form.
- Blue dot on Help menu icon when unread entries exist. Disappears when user opens the page. State stored in `user_news_seen`.
- Empty state: *"Nothing new yet. Check back after the next update."*

### 11.10 Offline banner and state

- Persistent amber banner on every screen while offline: *"You're offline. Showing your last saved view — changes are disabled until you reconnect."*
- All write controls visibly disabled with tooltip: *"Not available offline."*
- Banner disappears automatically on reconnection. No manual dismiss.
- Offline state detected within one network request cycle.
- Reconnection restores write capability without a page reload.
- Never imply a change was saved when it was not.

### 11.11 Search and command palette

- `Cmd+K` / `Ctrl+K` from any screen.
- Results scoped to authorized content.
- Result types visually distinguished (project, task, person, action).
- Loading, no-results, and error states.
- Focus trapped while open; Escape closes and restores focus to trigger.
- Task search uses the `tasks_fts` FTS5 index with prefix matching, ranked by relevance then recency; a query that looks like a key (e.g. MEDIA-42) jumps straight to that task. Results appear after 2 characters, debounced 200 ms.

### 11.12 Administration screens

- Searchable, sortable tables for: user list, access request queue, invite list, audit log, data deletion requests.
- Destructive actions visually distinct and always behind a confirmation screen (section 11.14).
- Role and status changes immediately reflected in UI and audit log.
- Audit log: append-only in UI. Search by actor, action type, date range. Export to CSV.
- Usage panel: current-day and current-month for D1 reads, D1 writes, emails. Warning banner at 80%; critical at 100%.
- Invite management: recipient email, project, role, sent-by, expiry, status. Actions: Cancel (pending), Resend (expired).
- Eligible for deletion queue (ADM-8): archived projects and suspended users past 6 months, with a Purge action per item.

### 11.13 Error boundaries

Every major section (board, task detail, notifications, reports, admin panel) wrapped in a React error boundary.

- On crash: contained error state — not a blank screen, not a full-page crash.
- Message: *"Something went wrong loading this section. Try refreshing the page."* + Refresh button.
- Error reported to a small client-error endpoint on the Worker, logged with request ID, and counted toward the error alert (NFR-15).
- No stack trace, error message, or internal path exposed to users.
- Rest of the app remains functional.

### 11.14 Confirmation screens

Every destructive action opens a confirmation dialog before anything changes. There are no undo-instead-of-confirm shortcuts.

- **Covered actions:** delete task, comment, attachment, subtask, label, component, milestone or saved filter; remove a project member or lower their role; archive a project; deny an access request; cancel an invite; suspend a user; revoke a session; approve a data deletion request; confirm a retention purge.
- **Dialog content:** a title naming the action and item ("Delete MEDIA-42?"), one sentence on the consequence ("This removes the task and its comments for everyone."), a Cancel button with initial focus, and a destructive button labelled with the verb ("Delete task"), never "OK" or "Yes".
- **High-impact actions** (archive project, suspend user, approve data deletion, retention purge) also require typing the project key or the user's email before the destructive button enables. Matching ignores letter case and leading or trailing spaces.
- Escape and clicking outside cancel. Keyboard and screen-reader accessible per section 13.
- **Confirmation token:** when the person confirms, the dialog sends an `X-Confirm-Action` header naming the action (e.g. `access_request.deny`). Only the confirmation dialog sets it. The API rejects a covered action without the matching header with 428, so no code path can skip the confirmation.
- After confirming: a toast confirms the result ("Task deleted."); the action is written to the audit log.

### 11.15 Public home and privacy pages (AUTH-10)

- **Home (`/`):** church logo, app name, two sentences on what the app does and who it's for, a Sign in with Google button, and a link to the privacy policy. Signed-in users are sent straight to My Work.
- **Privacy (`/privacy`):** what Google data is used (name, email, profile photo) and why, what the app stores, who can see it, the 6-month retention rule, how to request deletion (ADM-6), the NFR-24 data rule, and a contact address (media@ifcwpg.com).
- Both pages are static, load without signing in, and use the same design tokens as the app.

## 12. Responsive Design and PWA

Breakpoints: mobile 360–767 px, tablet 768–1023 px, desktop ≥ 1024 px.

- Reflow at each breakpoint. No unintended horizontal overflow (Kanban board only scrolls horizontally by design).
- Touch targets: minimum 44 × 44 CSS px.
- Primary actions in thumb zone on mobile. Use bottom sheets or bottom navigation where appropriate.
- Swipe gestures (TASK-12) are shortcuts only — always provide a visible tap alternative.
- Test at: 360 px, 768 px, 1024 px, 1440 px wide, and at 200% browser zoom.

### Navigation patterns by breakpoint

| Area | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| Primary nav | Persistent sidebar | Collapsible sidebar or tabs | Bottom navigation bar |
| Task detail | Sheet overlay | Sheet overlay | Full-screen |
| Board columns | All columns, horizontal scroll | All columns, horizontal scroll | One column, swipe to switch |
| Command palette | Full-width centered overlay | Full-width centered overlay | Full-screen |

## 13. Accessibility

Target: **WCAG 2.2 Level AA** for all new and updated work.

| Area | Requirement |
| --- | --- |
| Color contrast | Text ≥ 4.5:1; large text and UI components ≥ 3:1 |
| Keyboard navigation | All interactive elements reachable and operable via keyboard |
| Focus visibility | Focus ring visible in both themes; logical tab order |
| Focus management | Restored correctly after dialogs, sheets, and navigation changes |
| Screen reader | All controls have accessible names; dynamic changes announced via live regions |
| Dialogs and menus | Focus trapped while open; Escape closes; focus returns to trigger |
| Drag-and-drop | Keyboard alternative for every drag interaction |
| Forms | Labels associated with inputs; errors identify the field and explain the fix |
| Status | Never by color alone; always paired with text label or icon |
| Reduced motion | `prefers-reduced-motion` respected; essential state still communicated |
| Zoom | Layout functional at 200% without horizontal overflow |
| Touch targets | ≥ 44 × 44 CSS px |
| Charts | Text summary or accessible data table for every chart |
| Error messages | Identify the issue; explain how to proceed; no internal codes |

## 14. Content and UX Writing

Concise, human, respectful, action-oriented. Church context may inform warmth; the interface remains professional. Security and admin messages: calm and direct — no emoji.

### Copy reference

| Situation | Copy |
| --- | --- |
| Save confirmation | "Saved." or "Saved ✓" |
| Optimistic save failure | "We couldn't save this change. Check your connection and try again." |
| Optimistic card move failure | "Couldn't move this task. The board has been restored." |
| Conflict on task edit | "This task was updated by someone else. Review the changes before saving yours." |
| Offline banner | "You're offline. Showing your last saved view — changes are disabled until you reconnect." |
| Offline write disabled | "Not available offline." |
| Long request (> 8 s) | "This is taking longer than expected. Check your connection." |
| Session ended / revoked | "Your session has ended. Please sign in again." |
| Access suspended | "Your access has been suspended. If you think this is an error, contact an app administrator." |
| Expired invitation | "This invitation has expired. Contact the project admin to request a new one." |
| D1 outage | "The hub is temporarily unavailable. We're aware and working on it." |
| Rate limit — sign-in | "Too many sign-in attempts. Please wait a minute and try again." |
| Rate limit — access requests | "You've submitted the maximum requests for today. Check back tomorrow, or contact an admin directly." |
| Rate limit — feedback | "You've sent a lot of feedback today — thank you! You can submit more tomorrow." |
| Empty My Work | "You're all caught up. Check the board for work you can pick up." |
| Empty project board | "No tasks yet. Create the first one." |
| No projects assigned | "You haven't been added to any projects yet. Request access to get started." |
| Reports offline | "Reports aren't available offline. Reconnect to view the latest data." |
| Pending access (48 h) | "Still waiting? Send a reminder to the project admin." |
| Upload failed | "Upload failed. Try again." |
| File too large | "This file is too large. Maximum size is 10 MB." |
| Unsupported file type | "Only images and PDFs are supported." |
| Notification bell empty | "You're all caught up." |
| What's New empty | "Nothing new yet. Check back after the next update." |
| Error boundary | "Something went wrong loading this section. Try refreshing the page." |
| Delete confirmation (example) | Title "Delete MEDIA-42?" · body "This removes the task and its comments for everyone." · buttons "Cancel" / "Delete task" |
| High-impact confirmation | "Type MEDIA to confirm." (matching ignores letter case and leading or trailing spaces) |
| After a destructive action | "Task deleted." / "Member removed." / "Project archived." |
| Confirmed action failed | "That didn't go through. Check your connection and try again." |
| Sign-in failed (cancelled, unverified email, Google error) | "Sign-in didn't work. Please try again." |
| Invitation for a different email | "This invitation was sent to a different email address. Sign in with that Google account, or ask the project admin for a new invite." |
| Sign-in account hint | "Use the same Google account each time." |
| Data safety notice | "Don't include children's details or confidential pastoral information." |

## 15. Reusable Components

Every component family implemented once and used consistently. Each component: supports all three themes via tokens; supports all required states (default, hover, focus, pressed, disabled, loading, error, empty); meets WCAG 2.2 AA; supports 360 px upward; is keyboard-operable.

| Family | Key requirements |
| --- | --- |
| **Buttons** | Primary, secondary, destructive, icon-only. Destructive = visually distinct (icon or label, not only color). Loading = spinner inside the button. |
| **Form controls** | Text input, textarea, select, date picker, checkbox, radio, toggle. All have associated labels. Validation error shows below the field, identifies it, explains the fix. |
| **Dialogs and sheets** | Focus traps while open. Escape closes. Focus returns to trigger. Sheets animate from bottom (mobile) or right (desktop). Overlay dims background. Includes the confirmation dialog variant in section 11.14 (Cancel focused first, destructive button named with its verb, optional type-to-confirm field). |
| **Menus and popovers** | Close on Escape, click-outside, navigation. Arrow-key navigation. Auto-reposition to avoid viewport edges. |
| **Task cards** | Key, title, assignee avatar, due date, priority indicator, at most 2 label chips. Overdue = red date. Due soon = amber. Completed = muted. |
| **Badges and chips** | Consistent size/padding/radius from tokens. Color never alone for meaning. |
| **Toasts** | Bottom-right (desktop) or bottom-center (mobile). Auto-dismiss after 5 s, pause on hover. Success/warning/error variants. No Undo toasts for destructive actions; those use confirmation screens (section 11.14). Screen reader announcement. |
| **Skeletons** | Match approximate content shape. Subtle shimmer. Disappear only when content is ready. Do not show for requests < 200 ms. |
| **Empty states** | Relevant icon. One-line explanation. One primary action link. |
| **Error states** | Distinct from empty. Explains what went wrong. Retry action where applicable. |
| **Tables** | Sortable headers where relevant. Pagination for long lists. Row actions in a consistent position. |
| **Charts** | Title, legend, text summary or accessible data table. Respects reduced motion. Token-based colors. |
| **Focus indicators** | Visible in both themes. Minimum 2 px ring with 2 px offset. Never clipped by `overflow: hidden`. |
| **Rich text editor** | See section 11.5. |
| **File upload** | See section 11.4. |

## 16. Reports and Analytics

All figures come from `task_events`, so history stays accurate even after columns are renamed. Zero setup required.

| Report | Question | Chart | Who sees it |
| --- | --- | --- | --- |
| Status overview | Where is everything? | Stacked bar by workflow category | Project members |
| Overdue and due soon | What's at risk? | List, days overdue, grouped by assignee | Project members |
| Created vs completed | Are we keeping up? | Two lines, weekly, last 12 weeks | Project members |
| Workload | Is anyone overloaded? | Horizontal bars, open tasks per person | Project Admin (own), App Admin (all) |
| Cycle time | How long does work take? | Median + 85th percentile, monthly | Project members |
| Labels and components | Where is effort going? | Bars, open + completed per label | Project members |
| Milestone progress | Will we be ready? | Progress bar per milestone, open by priority | Project members |
| Church-wide overview | How are all teams doing? | One row per project: open, overdue, completed this month | App Admin |
| Access and adoption | Is the hub being used? | Active users/week, pending requests, avg approval time | App Admin |

**Rules:** Date range picker (4, 12, 26 weeks). Filters: assignee, label, priority. Every chart has "View tasks" drill-down. Every report exports to CSV. Reports respect permissions. Heavy aggregates pre-computed hourly and incrementally (only new events) into `report_snapshots`. Accessible legends. Not available offline.

## 17. Testing Strategy

Tests are named after requirement IDs (e.g. `AUTH-3`) so regressions trace directly to requirements.

### Unit tests (Vitest)

- All Zod validation schemas (valid and invalid inputs).
- All permission-check functions (one test per row of the permission matrix in section 2).
- Email deduplication logic.
- `rank` fractional string generation.
- Optimistic concurrency version check.
- Rate-limit counter logic.

### API / integration tests (Vitest + Hono test client)

- **Auth:** unauthenticated requests rejected; suspended user rejected within one request cycle; `revoked_at` check; Google ID token validation.
- **Permissions:** for every row in the permission matrix — action succeeds for allowed role, returns 403 for all others. These run in CI.
- **Access requests:** approval flow, denial flow, invite flow, expired-invite rejection.
- **Tasks:** create, edit, move (concurrent version conflict), delete within/after 24 hours.
- **Email outbox:** outbox row written in same transaction; deduplication; failure parking.
- **Rate limits:** correct 429 response after limit exceeded.
- **Destructive actions:** every covered action in section 11.14 is rejected by the API with 428 without the `X-Confirm-Action` header the confirmation dialog sends (section 11.14), and writes an audit event when confirmed.
- **Files:** a non-member gets 403 from `/api/attachments/:id`; a file whose bytes don't match an allowed type is rejected.
- **Rich text:** JSON with a disallowed node, mark or link scheme is rejected with 400.
- **Search:** results never include tasks from projects the user can't see.

### End-to-end tests (Playwright)

- Sign in → request access → pending screen → approval → My Work.
- Create task → assign → move on board → task detail → comment with @mention.
- Invite user → follow invite link → sign in → land on project.
- Admin approves and denies access requests.
- Session revoked → user sees correct message.
- Offline: go offline → attempt write → see disabled state → reconnect → write succeeds.
- Board drag-and-drop and keyboard Move alternative.
- Delete a task → confirmation dialog → Cancel leaves it; confirm removes it. Archive project requires typing the key.
- Home and privacy pages load signed out.

### Accessibility tests

- Run `axe-core` (via `@axe-core/playwright`) on every key screen.
- Verify keyboard navigation: board Move button, command palette, task sheet, rich text editor @mention.
- Verify focus restoration after dialogs, sheets, command palette.

### Performance tests

- Board load time with 500 tasks on simulated mid-range phone on 4G. Must be under 1.5 s.
- API p95 for most-called endpoints under representative load. Must be under 300 ms.
- Document conditions and results. Do not claim targets met without a recorded measurement.
- CPU: no request or cron run exceeds 10 ms CPU in Workers logs during a simulated Sunday load (NFR-22).
- Budget check: a one-day load replay at 50 users stays under 20% of each Workers and D1 daily limit.

### Must NOT be tested with mocked data

- Permission checks — always test the real authorization logic.
- Email outbox behavior — verify actual DB rows.
- Session revocation — verify the real `revoked_at` check in the Worker.

## 18. First Deploy and Seed Data

The app must be useful immediately after first deploy — no manual SQL commands required beyond the one-time admin step below.

### Automatic on first deploy

1. Database migrations are applied by CI with `wrangler d1 migrations apply` before each deploy (preview database first, then production). Idempotent: applied migrations are tracked in the `d1_migrations` table.
2. "Hub Feedback" project (key HUB, reserved) created automatically (PROJ-7) if it does not exist. Runs when an App Admin loads the app, so it also covers the first App Admin, who is promoted by script after signing in.
3. Default workflow states seeded for new projects (Backlog, To Do, In Progress, In Review, Done).

### Local development setup

For a first-time developer setting up locally, run `wrangler d1 migrations apply DB --local` to initialise the local D1 database before starting the dev server. This step is documented in the README.

### Required environment variables and secrets

| Variable | Where | Description |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Worker secret | From Google Cloud Console → OAuth 2.0 Client |
| `GOOGLE_CLIENT_SECRET` | Worker secret | From Google Cloud Console → OAuth 2.0 Client |
| `GOOGLE_REDIRECT_URI` | Worker secret | The app's OAuth callback URL on the verified domain |
| `SESSION_SECRET` | Worker secret | Random 256-bit value used to sign session cookies |
| `RESEND_API_KEY` | Worker secret | From the Resend dashboard (API Keys, sending access only) |
| `APP_BASE_URL` | Worker secret | The app's public URL (used in email links) |
| `EMAIL_FROM` | Worker secret | The sending address — set to `media@ifcwpg.com` |
| `CF_ACCOUNT_ID` | Worker secret | Cloudflare account ID, for the usage panel |
| `CF_ANALYTICS_TOKEN` | Worker secret | Cloudflare API token with Account Analytics: Read only. Lets the usage panel (ADM-4/5) read Worker request and D1 row counts from Cloudflare's GraphQL analytics API |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | Token with D1 edit, R2 write and Workers deploy rights, used by CI deploys, migrations and the nightly backup. Never stored in the Worker |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret | Same account ID, for CI |

> **Note:** App Admin email addresses are NOT stored as environment variables. The app resolves them dynamically by querying `users` where `app_role = 'admin'` and `status = 'active'`. Adding or removing an App Admin inside the app takes effect immediately for all system emails — no config or redeploy needed.

### First App Admin setup

1. Designated App Admin signs in with Google.
2. Admin runs a one-time script (documented in README) that sets `app_role = 'admin'` and `status = 'active'` for that user's `google_sub`. Run the script once per initial App Admin.
3. From that point, App Admins can promote additional users from within the app.

Initial App Admins: gboyega@ifcwpg.com and kome@ifcwpg.com. The README documents the exact `wrangler d1 execute` command. This is the only manual database operation required.

### No demo data

Do not seed fake tasks, users, or placeholder projects. The app starts empty and builds from real use.

### Domain and Google sign-in publishing

Because personal Gmail accounts can sign in, the Google OAuth consent screen must be set to External and published to Production. In Testing mode only listed test users (up to 100) can sign in.

1. Host the app on a subdomain of the church domain, recommended `hub.ifcwpg.com`. A Workers custom domain needs ifcwpg.com's DNS to be managed by Cloudflare; if it isn't, move the DNS (free) or pick another domain the church controls. A `workers.dev` address can't be used, because Google requires a domain the church has verified.
2. Verify ifcwpg.com in Google Search Console (it may already be verified through Workspace).
3. Consent screen: app name "Church Projects Hub", support email media@ifcwpg.com, home page `https://hub.ifcwpg.com/`, privacy policy `https://hub.ifcwpg.com/privacy` (AUTH-10, section 11.15), authorized domain ifcwpg.com, scopes openid, email, profile only.
4. Publish to Production. With only these basic scopes, no sensitive-scope review is needed; Google may still review the branding, which can take a few days. Do this before the pilot.

### Operations

- All alerts (error spikes, free-tier warnings) go to every active App Admin.
- The README holds a restore runbook for both paths in NFR-8; any App Admin with Cloudflare access can run it.
- Open: who is the named contact on Sundays (8 am–2 pm Winnipeg) if the app breaks?

## 19. Integration with the Media Checklist App

**Decision (14 Oct 2026):** The apps stay fully separate, with separate logins. A top nav link ("→ Checklist App") in each app may be added later without any data model changes. A Planning Center integration may be added in a future version; its scope is not yet defined.

No shared data model changes are required. Each app keeps its own D1 database. The free-tier budget in section 5 covers both apps sharing the same Cloudflare account.

## 20. Delivery Phases and Definition of Done

### Before any code

| Item | Owner | Status |
| --- | --- | --- |
| Settle all pre-build decisions (section 21) | @G | Done 14 Oct 2026 |
| Decide checklist integration approach (section 19) | @G | Done — fully separate |
| Confirm the app URL (recommended hub.ifcwpg.com) and that ifcwpg.com DNS is on Cloudflare (section 18) | @G | Not started |
| Verify ifcwpg.com in Google Search Console | @G | Not started |
| Google Cloud OAuth client created; consent screen set to External and published to Production | @G | Not started |
| Resend domain verification for ifcwpg.com: DKIM, `send.` subdomain SPF/MX, single DMARC record (section 8) | @G | Not started |
| Cloudflare API tokens created: analytics read-only for the Worker, deploy/backup token for GitHub | @G | Not started |
| Clickable wireframes for 6 key screens reviewed with 3 volunteers | @G | Not started |
| All environment variables in section 18 ready | @G | Not started |
| Name the Sunday contact for outages (section 18) | @G | Not started |

### Recommended phase order

1. Design foundation: tokens, typography, spacing, iconography, themes, focus states, motion system.
2. App shell and auth: navigation, Google sign-in, pending screen, suspension screen, responsive layout.
3. Core task experience: My Work, board, list view, task detail, rich text, file attachments, search, filters, drag-and-drop.
4. Interaction refinement: keyboard alternatives, toasts, skeletons, empty states, offline banner, error boundaries.
5. Notifications and email: in-app bell, email outbox, digest worker, notification preferences, What's New.
6. Administration: request queue, user management, invites, audit log, usage panel, data deletion.
7. Reports: all report types, CSV export, chart accessibility, report snapshots.
8. Quality and launch: accessibility audit, responsive validation, performance measurement, regression testing.

### Phase reporting

Each phase report includes: requirement IDs addressed; files and components changed; checks and tests run with actual results; known defects; decisions requiring approval.

### Acceptance criteria — a screen is done when

**Visual and interaction:** visual hierarchy apparent; design tokens used (no hardcoded values); all three themes work; all states implemented (loading, empty, success, error, disabled, conflict, offline); motion purposeful and reduced-motion respected; layout works at all breakpoints and 200% zoom; copy matches section 14.

**Accessibility:** keyboard-only operation possible for all essential workflows; focus visible and logical; screen-reader labels and live regions meaningful; status not by color alone; forms and errors recoverable; WCAG 2.2 AA checks run and documented.

**Functional integrity:** existing behavior correct; role boundaries intact; real data used; failed operations don't mislead; optimistic updates recover on rejection; security screens show no app navigation.

**Performance:** targets measured under specified conditions and documented.

### Definition of done

Church Projects Hub shall feel like a cohesive, polished, modern product — not a generic administration dashboard with animations added afterward. Every screen is intentional. Every interaction communicates its state. Every animation has a purpose. Every permission is enforced. Every important failure has a recovery path.

## 21. Decisions

All pre-build questions were settled by @G on 14 Oct 2026. Each decision is applied in the section it affects.

| Question | Decision |
| --- | --- |
| Which teams launch first? | Media Team only. 1 or 2 teams using the app within 90 days. |
| Who are the App Admins? | gboyega@ifcwpg.com and kome@ifcwpg.com. Set via the first-deploy script (section 18). |
| Does the church have Google Workspace? | Yes. Resend is the primary sender (100 emails/day free); Workspace Gmail is the fallback behind `EmailSender` (section 8). |
| Personal Gmail accounts allowed? | Yes. Sign-in is not restricted to the church domain; the approval step keeps the app private. Requires a published Google consent screen (section 18). |
| Checklist app integration | Fully separate (section 19). A Planning Center integration may be added later; scope to be defined. |
| Separate Cloudflare account or shared? | Shared — the combined budget is in section 5. |
| Domain and email sending address | Church domain: ifcwpg.com. Emails sent from `media@ifcwpg.com`. App URL recommended `hub.ifcwpg.com`; needed before Google publishing. |
| Data retention | 6 months — archived projects and suspended users' details become eligible for full deletion, confirmed by an App Admin (ADM-8). |
| Hidden projects at launch | None. Media is the only team project at launch; the Hub Feedback system project is visible only to App Admins. |
| Destructive actions | Always behind a confirmation screen; no undo-instead-of-confirm (section 11.14). |
