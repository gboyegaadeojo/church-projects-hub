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

Documented in Stage 2 (requirements section 18).

## Deploys

From `main` through GitHub Actions (added in Stage 2). No deploys between Saturday 6 pm and Sunday 2 pm Winnipeg time.
