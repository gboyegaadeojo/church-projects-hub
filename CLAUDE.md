# Church Projects Hub — instructions for Claude Code

A private, Jira-style work tracker for Immanuel Fellowship Church volunteer teams. Owner: @G.

## Source of truth

- `docs/REQUIREMENTS.md` (v4.3) is the single source of truth. Read the sections named in the current stage before writing code.
- Never resolve a conflict between requirements silently. Stop, describe the conflict, and ask @G.
- `docs/BUILD-STAGES.md` lists the build stages. Work on one stage at a time and only on what that stage names.

## Stack (do not swap without asking)

- TypeScript everywhere. Node 24 LTS, npm 11.
- Cloudflare Worker (`worker/`) with Hono; all API routes under `/api`.
- React 19 + Vite + React Router + TanStack Query (`src/`), served as Workers static assets.
- Cloudflare D1 (SQLite) with Drizzle ORM; R2 for attachments (served through the Worker, no signed URLs).
- Zod schemas in `shared/`, used by both client and server.
- Tailwind CSS v4 with design tokens in `src/index.css`; Radix UI primitives; dnd-kit; Tiptap (stored as JSON).
- Email through Brevo behind an `EmailSender` interface.
- Tests: Vitest inside the Workers runtime (`@cloudflare/vitest-plugin`), Playwright for end-to-end.

## Commands

- `npm run dev` — app + Worker + local D1/R2 at http://localhost:5174 (pinned with strictPort: it is the Google redirect URI's port)
- `npm run typecheck`, `npm test`, `npm run build` — all three must pass before a stage is reported done
- `npm run db:generate` — create a migration from `worker/db/schema.ts`; review the SQL before applying
- `npm run db:migrate:local` — apply migrations to the local D1
- `npm run cf-typegen` — regenerate `worker/worker-configuration.d.ts` after changing `wrangler.jsonc`

## Rules that are easy to break

- Authorization is checked in the API on every request (NFR-1). Hiding UI is never the control.
- Never store or render raw HTML from users. Rich text is Tiptap JSON validated by Zod (section 11.5).
- Never expose stack traces, error codes or internal paths to users. Use the copy in section 14.
- Every destructive action goes through the confirmation dialog (section 11.14) and is audit-logged.
- Free-tier budget rules (section 5): no polling while the tab is hidden; `last_seen_at` at most every 15 minutes; incremental report snapshots; one cron schedule only; never a global `run_worker_first`.
- Stay within 10 ms CPU per request (NFR-22): do heavy work in SQL, batch, stream CSV.
- Use design tokens; no hardcoded colours, sizes or durations in components.
- No children's personal details or pastoral information in seed data, fixtures or examples (NFR-24).
- No demo data in migrations or seeds (section 18).
- Never deploy between Saturday 6 pm and Sunday 2 pm Winnipeg time (NFR-6).
- Do not commit secrets. Local secrets go in `.dev.vars` (git-ignored).

## Tests

- Name tests after requirement IDs, e.g. `describe("AUTH-7 …")` (section 17).
- Permission checks, email outbox rows and session revocation are tested against the real logic and real D1, never mocks.

## Git

- One branch and one pull request per stage (or per requirement ID within a stage), e.g. `stage-2/auth`.
- Small commits with clear messages. CI must be green before merging to `main`.

## Reporting at the end of each stage

Report: requirement IDs addressed; files changed; commands run with their actual results; known defects; decisions needing @G's approval. Do not claim a performance or accessibility target is met without a recorded measurement.
