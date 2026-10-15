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
5. Each person reloads the app. From then on, App Admins approve everyone else from the access queue (`/admin/requests`), so no more SQL is needed.

### Local testing

`npm run dev:setup-local` does the same for your local database only: it makes gboyega@ifcwpg.com an active App Admin and creates a Media project (key `MEDIA`) with the default columns, so you can try approvals. Sign in once locally first. Use `-- --email someone@example.org` for another account. It always uses `--local` and refuses `--remote` or CI, and it's safe to run more than once.

## Deploys

From `main` through GitHub Actions (added in Stage 2). No deploys between Saturday 6 pm and Sunday 2 pm Winnipeg time.
