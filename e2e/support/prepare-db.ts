// Run by playwright.config.ts before the e2e dev server starts: `node e2e/support/prepare-db.ts`.
//
// Builds a fresh local D1 for the e2e server in .wrangler/e2e-state (never your dev data in
// .wrangler/state): wipes it, applies every migration, then seeds the people, sessions, projects,
// requests and invites from fixtures.ts. Local only; it never passes --remote.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOARD_LABEL,
  BOARD_TASKS,
  COLUMNS,
  HOUR,
  INVITES,
  hashInviteToken,
  PERSONAS,
  PROJECTS,
  REQUESTS,
  sessionIdFor,
  TASK_PROJECTS,
} from "./fixtures.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Keep in step with CPH_STATE_DIR in playwright.config.ts.
const STATE_DIR = ".wrangler/e2e-state";
const stateDir = join(root, STATE_DIR);
const devVars = join(root, ".dev.vars");
const wranglerBin = join(root, "node_modules", "wrangler", "bin", "wrangler.js");

function wrangler(args: string[]) {
  const result = spawnSync(process.execPath, [wranglerBin, ...args, "--local", "--persist-to", stateDir], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "1" }, // no interactive "apply these migrations?" prompt
  });
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr);
    process.exit(1);
  }
}

// CI has no .dev.vars: write throwaway values. Locally, your own .dev.vars is used and never touched.
if (!existsSync(devVars)) {
  if (!process.env.CI) {
    console.error("e2e needs .dev.vars (copy .dev.vars.example and fill in SESSION_SECRET).");
    process.exit(1);
  }
  writeFileSync(
    devVars,
    ["GOOGLE_CLIENT_ID=e2e", "GOOGLE_CLIENT_SECRET=e2e", "GOOGLE_REDIRECT_URI=http://127.0.0.1:5179/api/auth/callback",
      `SESSION_SECRET=e2e-${crypto.randomUUID()}`, ""].join("\n"),
  );
}

rmSync(stateDir, { recursive: true, force: true });
mkdirSync(stateDir, { recursive: true });
wrangler(["d1", "migrations", "apply", "DB"]);

const now = Date.now();
const q = (s: string) => `'${s.replaceAll("'", "''")}'`;

const sql: string[] = [];
for (const p of PROJECTS) {
  const hidden = "hidden" in p && p.hidden ? 1 : 0;
  sql.push(
    `INSERT INTO projects (id, key, name, description, colour, icon, hidden, created_at, updated_at)
     VALUES (${p.id}, ${q(p.key)}, ${q(p.name)}, ${q(p.description)}, 'blue', 'folder', ${hidden}, ${now}, ${now});`,
  );
  COLUMNS.forEach((c, position) =>
    sql.push(
      `INSERT INTO workflow_states (project_id, name, category, position, blocks, created_at, updated_at)
       VALUES (${p.id}, ${q(c.name)}, ${q(c.category)}, ${position}, ${"blocks" in c && c.blocks ? 1 : 0}, ${now}, ${now});`,
    ),
  );
}
for (const p of PERSONAS) {
  sql.push(
    `INSERT INTO users (id, google_sub, email, name, app_role, status, created_at, updated_at)
     VALUES (${p.id}, ${q(`e2e-${p.key}`)}, ${q(p.email)}, ${q(p.name)}, ${q(p.appRole)}, ${q(p.status)}, ${now}, ${now});`,
    `INSERT INTO sessions (id, user_id, expires_at, created_at, updated_at, created_by)
     VALUES (${q(sessionIdFor(p))}, ${p.id}, ${now + 24 * HOUR}, ${now}, ${now}, ${p.id});`,
  );
  for (const m of p.memberships) {
    sql.push(
      `INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
       VALUES (${m.projectId}, ${p.id}, ${q(m.role)}, ${now}, ${now});`,
    );
  }
}
// Board and detail projects: a label and three tasks in To Do (reported by that viewport's contributor).
for (const project of TASK_PROJECTS) {
  const v = project.key.endsWith("DESK") ? "desktop" : "mobile";
  const reporter = PERSONAS.find((p) => p.key === `mover-${v}`)!;
  const toDo = `(SELECT id FROM workflow_states WHERE project_id = ${project.id} AND position = 1)`;
  sql.push(
    `INSERT INTO labels (project_id, name, colour, created_at, updated_at) VALUES (${project.id}, ${q(BOARD_LABEL)}, 'teal', ${now}, ${now});`,
    `UPDATE projects SET next_task_number = ${BOARD_TASKS.length + 1} WHERE id = ${project.id};`,
  );
  BOARD_TASKS.forEach((t, i) => {
    sql.push(
      `INSERT INTO tasks (project_id, number, title, state_id, priority, reporter_id, rank, created_at, updated_at, created_by)
       VALUES (${project.id}, ${i + 1}, ${q(t.title)}, ${toDo}, ${q(t.priority)}, ${reporter.id}, ${q(`a${i}`)}, ${now}, ${now}, ${reporter.id});`,
      `INSERT INTO tasks_fts (rowid, project_id, key, title, body)
       SELECT id, project_id, ${q(`${project.key}-${i + 1}`)}, title, '' FROM tasks WHERE project_id = ${project.id} AND number = ${i + 1};`,
    );
    if (t.label) {
      sql.push(
        `INSERT INTO task_labels (task_id, label_id)
         SELECT t.id, l.id FROM tasks t, labels l WHERE t.project_id = ${project.id} AND t.number = ${i + 1} AND l.project_id = ${project.id};`,
      );
    }
  });
}
for (const r of REQUESTS) {
  const user = PERSONAS.find((p) => p.key === r.personaKey);
  if (!user) throw new Error(`Unknown persona ${r.personaKey}`);
  const at = now - r.ageHours * HOUR;
  const decided = r.status === "denied" ? `${at + HOUR}, 1, ${q(r.reason ?? "")}` : "NULL, NULL, NULL";
  sql.push(
    `INSERT INTO access_requests (user_id, project_id, note, status, decided_at, decided_by, decision_reason, created_at, updated_at, created_by)
     VALUES (${user.id}, ${r.projectId}, ${q(r.note ?? "")}, ${q(r.status)}, ${decided}, ${at}, ${at}, ${user.id});`,
  );
}
for (const i of Object.values(INVITES)) {
  sql.push(
    `INSERT INTO invites (project_id, role, email, invited_by, token, expires_at, created_at, updated_at, created_by)
     VALUES (${i.projectId}, ${q(i.role)}, ${q(i.email)}, 1, ${q(hashInviteToken(i.token))}, ${now + i.expiresInHours * HOUR}, ${now}, ${now}, 1);`,
  );
}

const seedFile = join(stateDir, "seed.sql");
writeFileSync(seedFile, sql.join("\n"));
wrangler(["d1", "execute", "DB", "--file", seedFile]);
console.log(`e2e database ready in ${STATE_DIR}: ${PERSONAS.length} people, ${REQUESTS.length} requests.`);
