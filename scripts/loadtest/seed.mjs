// Synthetic data for the STAGING database only (Stage 8 measurements, docs/REQUIREMENTS.md section 17).
// Never run against production: section 18 forbids demo data there. Contains no real people, and no
// children's or pastoral details (NFR-24).
//
//   node scripts/loadtest/seed.mjs > seed.sql
//   npx wrangler d1 execute DB --env staging --remote --file seed.sql
//
// Shape: 50 volunteers (user 1 is an App Admin), a "Load test" project with 500 tasks for the board
// measurement (NFR-11), and four team projects with 60 tasks each. Every volunteer is a Contributor on the
// load-test project and on one team project. Each volunteer has a session "loadtest-session-<n>" that
// scripts/loadtest/replay.mjs and board.mjs sign with the staging SESSION_SECRET.

import { generateNKeysBetween } from "fractional-indexing";

const USERS = 50;
const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

const projects = [
  { id: 1, key: "LOAD", name: "Load test", tasks: 500 },
  { id: 2, key: "SOUND", name: "Sound team", tasks: 60 },
  { id: 3, key: "STREAM", name: "Stream team", tasks: 60 },
  { id: 4, key: "WELCOME", name: "Welcome team", tasks: 60 },
  { id: 5, key: "SETUP", name: "Setup team", tasks: 60 },
];
const COLUMNS = [
  ["Backlog", "todo"],
  ["To Do", "todo"],
  ["In Progress", "in_progress"],
  ["In Review", "in_progress"],
  ["Done", "done"],
];
const LABELS = [
  ["Audio", "teal"],
  ["Video", "blue"],
  ["Lighting", "amber"],
  ["Slides", "purple"],
  ["Urgent", "red"],
];
const PRIORITIES = ["urgent", "high", "medium", "medium", "low"];
const VERBS = ["Check", "Replace", "Test", "Print", "Order", "Clean", "Label", "Set up", "Pack", "Update"];
const THINGS = ["mic batteries", "stream encoder", "slide notes", "cable run", "stage lights", "projector", "welcome table", "chairs", "sound desk", "spare lanyards"];

// Deterministic pseudo-random numbers, so every run seeds the same data.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (a) => a[Math.floor(rand() * a.length)];

const sql = [];
for (let u = 1; u <= USERS; u++) {
  sql.push(
    `INSERT INTO users (id, google_sub, email, name, app_role, status, timezone, created_at, updated_at)
     VALUES (${u}, ${q(`loadtest-${u}`)}, ${q(`volunteer${u}@example.org`)}, ${q(`Volunteer ${u}`)}, ${q(u === 1 ? "admin" : "member")}, 'active', 'America/Winnipeg', ${now}, ${now});`,
    `INSERT INTO sessions (id, user_id, expires_at, created_at, updated_at, created_by)
     VALUES (${q(`loadtest-session-${u}`)}, ${u}, ${now + 7 * DAY}, ${now}, ${now}, ${u});`,
  );
}

let stateId = 0;
let labelId = 0;
for (const p of projects) {
  sql.push(
    `INSERT INTO projects (id, key, name, description, colour, icon, hidden, next_task_number, created_at, updated_at)
     VALUES (${p.id}, ${q(p.key)}, ${q(p.name)}, ${q("Synthetic data for load testing.")}, 'blue', 'folder', 0, ${p.tasks + 1}, ${now}, ${now});`,
  );
  const states = COLUMNS.map(([name, category], position) => {
    stateId++;
    sql.push(
      `INSERT INTO workflow_states (id, project_id, name, category, position, created_at, updated_at)
       VALUES (${stateId}, ${p.id}, ${q(name)}, ${q(category)}, ${position}, ${now}, ${now});`,
    );
    return stateId;
  });
  const labels = LABELS.map(([name, colour]) => {
    labelId++;
    sql.push(`INSERT INTO labels (id, project_id, name, colour, created_at, updated_at) VALUES (${labelId}, ${p.id}, ${q(name)}, ${q(colour)}, ${now}, ${now});`);
    return labelId;
  });
  // Members: everyone on LOAD; a quarter of the volunteers on each team project.
  for (let u = 1; u <= USERS; u++) {
    if (p.id === 1 || (u % 4) + 2 === p.id) {
      sql.push(`INSERT INTO project_members (project_id, user_id, role, created_at, updated_at) VALUES (${p.id}, ${u}, 'contributor', ${now}, ${now});`);
    }
  }
  // Tasks spread over the columns, each column with its own rank order.
  const perColumn = states.map(() => []);
  for (let n = 1; n <= p.tasks; n++) perColumn[Math.floor(rand() * states.length)].push(n);
  perColumn.forEach((numbers, col) => {
    const ranks = generateNKeysBetween(null, null, numbers.length);
    numbers.forEach((n, i) => {
      const assignee = rand() < 0.7 ? 1 + Math.floor(rand() * USERS) : null;
      const due = rand() < 0.5 ? new Date(now + Math.floor((rand() * 40 - 10) * DAY)).toISOString().slice(0, 10) : null;
      const title = `${pick(VERBS)} the ${pick(THINGS)} (${n})`;
      sql.push(
        `INSERT INTO tasks (project_id, number, title, state_id, priority, assignee_id, reporter_id, due_date, rank, created_at, updated_at, created_by)
         VALUES (${p.id}, ${n}, ${q(title)}, ${states[col]}, ${q(pick(PRIORITIES))}, ${assignee ?? "NULL"}, 1, ${due ? q(due) : "NULL"}, ${q(ranks[i])}, ${now - 30 * DAY}, ${now}, 1);`,
        `INSERT INTO tasks_fts (rowid, project_id, key, title, body)
         SELECT id, project_id, ${q(`${p.key}-${n}`)}, title, '' FROM tasks WHERE project_id = ${p.id} AND number = ${n};`,
      );
      if (rand() < 0.4) {
        sql.push(
          `INSERT INTO task_labels (task_id, label_id) SELECT id, ${pick(labels)} FROM tasks WHERE project_id = ${p.id} AND number = ${n};`,
        );
      }
    });
  });
}

process.stdout.write(sql.join("\n") + "\n");
