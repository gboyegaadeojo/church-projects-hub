# Church Projects Hub

A private, Jira-style work tracker for Immanuel Fellowship Church volunteer teams. Google sign-in, admin approval, runs on Cloudflare's free tier.

- Requirements: [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)
- Build plan and Claude Code prompts: [`docs/BUILD-STAGES.md`](docs/BUILD-STAGES.md)
- Rules for Claude Code: [`CLAUDE.md`](CLAUDE.md)

## Requirements

- Node 24 LTS with npm 11 (`node -v`, `npm -v`)
- A Cloudflare account (the church's) and the Wrangler CLI (installed with the project)

## Setup

```sh
npm install
npm run db:migrate:local   # creates the local D1 tables; re-run after pulling new migrations
npm run dev                # http://localhost:5174
```

Local secrets go in `.dev.vars` (next to `wrangler.jsonc`) — copy `.dev.vars.example` and fill it in. Generate `SESSION_SECRET` with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

The dev server always runs on port 5174 (`strictPort`), because Google only accepts the exact redirect URI registered on the OAuth client. Add `http://localhost:5174/api/auth/callback` as an authorized redirect URI in Google Cloud Console. If something else is using 5174, the dev server stops with an error instead of moving to another port.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | React app + Worker + local D1 and R2 |
| `npm test` | Tests inside the Workers runtime |
| `npm run test:low-mem` | The same tests one file at a time, for low-memory machines (use it if `npm test` crashes with "JavaScript heap out of memory") |
| `npm run typecheck` | TypeScript checks for app, Worker and config |
| `npm run build` | Production build |
| `npm run db:generate` | New migration from `worker/db/schema.ts` |
| `npm run db:migrate:local` | Apply migrations locally |
| `npm run dev:setup-local` | Local only: make your account an App Admin and add a Media project to test approvals |
| `npm run cf-typegen` | Regenerate binding types after editing `wrangler.jsonc` |

## Project layout

```
src/        React app (pages, components, design tokens in index.css)
worker/     Cloudflare Worker: Hono API, jobs, Drizzle schema
shared/     Zod schemas used by both sides
migrations/ D1 SQL migrations
test/       Vitest tests (run inside the Workers runtime)
docs/       Requirements and build stages
```

## First App Admin

Everyone who signs in starts as Pending, so the first App Admins are promoted by hand, once, on the production database (requirements section 18). Do this after the first deploy, for gboyega@ifcwpg.com and kome@ifcwpg.com.

1. Each person signs in once at the live site with their Google account. They land on the Request access screen; that's expected.
2. Look up their Google account ID (`google_sub`) by email, so the update below can't hit the wrong row:

   ```sh
   npx wrangler d1 execute DB --remote --command "SELECT id, google_sub, email, app_role, status FROM users WHERE lower(email) = 'gboyega@ifcwpg.com';"
   ```

   Check that exactly one row comes back and the email is right.
3. Promote that account by its `google_sub` (paste the value from step 2):

   ```sh
   npx wrangler d1 execute DB --remote --command "UPDATE users SET app_role = 'admin', status = 'active', updated_at = unixepoch() * 1000 WHERE google_sub = 'PASTE_GOOGLE_SUB_HERE';"
   ```

   The output should say `changes: 1`.
4. Repeat steps 2 and 3 for kome@ifcwpg.com.
5. Each person reloads the app. The first App Admin page load also creates the built-in Hub Feedback project (key `HUB`, App Admins only, PROJ-7); it is re-created the same way if it ever goes missing. From then on, App Admins create team projects at Manage projects (`/admin/projects`) and approve everyone else from the access queue (`/admin/requests`), so no more SQL is needed.

### Local testing

`npm run dev:setup-local` does the same for your local database only: it makes gboyega@ifcwpg.com an active App Admin and creates a Media project (key `MEDIA`) with the default columns, so you can try approvals. Sign in once locally first. Use `-- --email someone@example.org` for another account. It always uses `--local` and refuses `--remote` or CI, and it's safe to run more than once.

## Deploys

Production deploys run from `main` through GitHub Actions ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)): when CI passes on a push to `main`, the workflow applies D1 migrations to production, then deploys the Worker. There are **no deploys between Saturday 6 pm and Sunday 2 pm Winnipeg time** (NFR-6). A deploy that lands in that window fails with a message saying so; re-run it from the Actions tab after Sunday 2 pm, or use **Actions → Deploy → Run workflow**.

Cloudflare resources (church account):

| Resource | Name |
| --- | --- |
| Worker | `church-projects-hub` (`church-projects-hub.media-5f7.workers.dev` until the custom domain is added) |
| D1 database | `church-projects-hub` |
| R2 bucket, attachments | `church-projects-hub-files` |
| R2 bucket, backups | `church-projects-hub-backups` (lifecycle rule `expire-d1-backups` deletes `d1/` objects after 30 days) |

### One-time setup

1. In Cloudflare, **My Profile → API Tokens → Create Token → Custom token** with these permissions on the church account: *Workers Scripts: Edit*, *D1: Edit*, *Workers R2 Storage: Edit*, *Account Settings: Read*. Copy the token.
2. In GitHub, **Settings → Secrets and variables → Actions → New repository secret**:
   - `CLOUDFLARE_API_TOKEN`: the token from step 1
   - `CLOUDFLARE_ACCOUNT_ID`: the account ID shown on the Cloudflare dashboard's Workers page
   Until both exist, the deploy and backup workflows skip with a warning instead of failing.
3. Production Worker secrets (section 18), each with `npx wrangler secret put <NAME>`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (`https://hub.ifcwpg.com/api/auth/callback`), and later `BREVO_API_KEY`, `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN`. `SESSION_SECRET` is already set. `APP_BASE_URL` and `EMAIL_FROM` are in `wrangler.jsonc`.
4. Custom domain: in Cloudflare, **Workers & Pages → church-projects-hub → Settings → Domains & Routes → Add → Custom domain** `hub.ifcwpg.com` (needs ifcwpg.com's DNS on Cloudflare).

### Rolling back

**Actions → Rollback → Run workflow** puts the previous Worker version back (or the version ID you give it; list them with `npx wrangler deployments list`). It is allowed during the Sunday freeze. It does **not** undo database migrations. Migrations only add to the schema, so older code keeps working against a newer database; if a migration itself caused the problem, restore the database (below).

## Backups and restoring (NFR-8)

Two ways back, for different situations. Test one of them every quarter.

### 1. Time Travel: recent mistakes, last 7 days

D1 keeps a point-in-time history for 7 days on the free plan. Use it to undo something that happened recently, such as a bad bulk change. It rewinds the **whole** database, so everything written after that moment is lost.

```sh
# Pick a moment just before the problem (Unix seconds or an RFC 3339 time with a timezone)
npx wrangler d1 time-travel info church-projects-hub --timestamp="2026-10-19T09:00:00-05:00"
npx wrangler d1 time-travel restore church-projects-hub --timestamp="2026-10-19T09:00:00-05:00"
```

The restore prints a bookmark for the state just before the restore, so the restore itself can be undone with `--bookmark=<that value>`.

### 2. Nightly export: any day in the last 30 days

[`.github/workflows/backup.yml`](.github/workflows/backup.yml) exports the whole database at 3 am Winnipeg time to `church-projects-hub-backups/d1/church-projects-hub-YYYY-MM-DD-HHMM.sql.gz`. Run it now with **Actions → Backup → Run workflow** (for example before a risky change). The export briefly blocks the database, which is why it runs at night.

To restore from it, load the export into a **new** database and point the app at it, so the damaged one stays as evidence and nothing is overwritten:

```sh
# 1. Find and download the backup (Cloudflare dashboard → R2 → church-projects-hub-backups → d1/ lists them)
npx wrangler r2 object get "church-projects-hub-backups/d1/church-projects-hub-2026-10-18-0300.sql.gz" --file backup.sql.gz --remote
gunzip backup.sql.gz

# 2. Load it into a new database
npx wrangler d1 create church-projects-hub-restored
npx wrangler d1 execute church-projects-hub-restored --remote --file backup.sql

# 3. Rebuild the task search index (exports can't include FTS5 tables, so it isn't in the backup)
npx wrangler d1 execute church-projects-hub-restored --remote --file scripts/rebuild-search.sql
```

4. In `wrangler.jsonc`, set `database_name` to `church-projects-hub-restored` and `database_id` to the ID that `d1 create` printed. Commit to `main` (outside the Sunday freeze); the deploy workflow applies any newer migrations and deploys.
5. Record "restore performed" in the audit log from the admin area once it exists (Stage 6); until then note it in the pull request.
