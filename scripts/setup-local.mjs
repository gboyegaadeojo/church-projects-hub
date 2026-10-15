// npm run dev:setup-local [-- --email someone@example.org]
//
// LOCAL DEVELOPMENT ONLY. Makes one signed-in account an active App Admin and creates a "Media" project
// (key MEDIA) with the default workflow columns in the local D1, so approvals can be tried out.
// It always runs `wrangler d1 execute DB --local` and refuses anything that could reach the remote database.
// Production App Admins are set with the first-admin commands in README.md (section 18).

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_EMAIL = "gboyega@ifcwpg.com";
const args = process.argv.slice(2);
/** Temp folder for the SQL file; removed on every exit, since process.exit skips `finally`. */
let dir;

function fail(message) {
  if (dir) rmSync(dir, { recursive: true, force: true });
  console.error(`\n${message}\n`);
  process.exit(1);
}

// Refuse anything that hints at the remote database.
if (args.some((a) => /remote|preview|--env|production/i.test(a))) {
  fail("Refusing to run: this script only touches the LOCAL database. Remove --remote / --env / --preview.");
}
if (process.env.CI) fail("Refusing to run in CI: this script is for a developer's local database only.");

const emailIndex = args.indexOf("--email");
const email = (emailIndex >= 0 ? args[emailIndex + 1] : DEFAULT_EMAIL)?.trim().toLowerCase();
if (!email || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) fail(`Not an email address: ${email}`);

// wrangler's package "exports" hide bin/, so locate the file from the project's node_modules.
const wranglerBin = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "wrangler", "bin", "wrangler.js");
if (!existsSync(wranglerBin)) fail("wrangler isn't installed. Run `npm install` first.");
dir = mkdtempSync(join(tmpdir(), "cph-setup-"));

/** Runs SQL against the LOCAL D1 only and returns wrangler's JSON results. */
function d1Local(sql) {
  const file = join(dir, "query.sql");
  writeFileSync(file, sql);
  // Node runs wrangler's own entry point directly: no shell, so no quoting surprises on any platform.
  const result = spawnSync(process.execPath, [wranglerBin, "d1", "execute", "DB", "--local", "--json", "--file", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) fail(`wrangler failed:\n${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

try {
  const now = Date.now();
  // The email has been validated above, so it is safe inside a SQL string literal.
  const found = d1Local(`SELECT id, status, app_role FROM users WHERE lower(email) = '${email}';`)[0]?.results ?? [];

  d1Local(`
    INSERT INTO projects (key, name, description, colour, icon, created_at, updated_at)
    SELECT 'MEDIA', 'Media', 'Media team backlog: sound, lighting, stream and slides.', 'blue', 'clapperboard', ${now}, ${now}
    WHERE NOT EXISTS (SELECT 1 FROM projects WHERE key = 'MEDIA');

    -- Default workflow columns (PROJ-2), only if MEDIA has none yet.
    INSERT INTO workflow_states (project_id, name, category, position, created_at, updated_at)
    SELECT p.id, s.name, s.category, s.position, ${now}, ${now}
    FROM projects p,
      (SELECT 'Backlog' AS name, 'todo' AS category, 0 AS position
       UNION ALL SELECT 'To Do', 'todo', 1
       UNION ALL SELECT 'In Progress', 'in_progress', 2
       UNION ALL SELECT 'In Review', 'in_progress', 3
       UNION ALL SELECT 'Done', 'done', 4) s
    WHERE p.key = 'MEDIA' AND NOT EXISTS (SELECT 1 FROM workflow_states w WHERE w.project_id = p.id);
  `);
  console.log("Local project MEDIA is ready (with Backlog, To Do, In Progress, In Review, Done).");

  if (found.length === 0) {
    fail(
      `No local account for ${email} yet. Run \`npm run dev\`, sign in at http://localhost:5174 with that ` +
        "Google account, then run this script again.",
    );
  }
  d1Local(`UPDATE users SET app_role = 'admin', status = 'active', updated_at = ${now} WHERE lower(email) = '${email}';`);
  console.log(`${email} is now an active App Admin in the LOCAL database. Reload the app to see it.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
