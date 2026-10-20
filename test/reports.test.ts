import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { type ChurchReports, churchDate, percentiles, type ProjectReports, weekStart } from "../shared/reports";
import type { TaskDetail } from "../shared/tasks";
import { updateReportSnapshots } from "../worker/reports/data";
import { call, type Client } from "./helpers/auth";
import { actorAs, addMember, createProject } from "./helpers/fixtures";

// Section 16 / RPT-1 to RPT-4 against the real API, D1 and hourly job.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Setup = { p: { id: number; key: string }; states: Record<"todo" | "doing" | "done", number>; admin: Client; contributor: Client };

async function setup(): Promise<Setup> {
  const p = await createProject();
  const states = {} as Setup["states"];
  for (const [position, [name, category, key]] of (
    [
      ["To Do", "todo", "todo"],
      ["Doing", "in_progress", "doing"],
      ["Done", "done", "done"],
    ] as const
  ).entries()) {
    const row = await env.DB.prepare("INSERT INTO workflow_states (project_id, name, category, position) VALUES (?, ?, ?, ?) RETURNING id").bind(p.id, name, category, position).first<{ id: number }>();
    states[key] = row!.id;
  }
  return { p, states, admin: await actorAs("projectAdmin", p.id), contributor: await actorAs("contributor", p.id) };
}

async function task(s: Setup, body: Record<string, unknown>) {
  return ((await (await call(s.admin, "POST", `/api/projects/${s.p.id}/tasks`, body)).json()) as { task: TaskDetail }).task;
}

const move = (s: Setup, id: number, stateId: number) => call(s.admin, "POST", `/api/tasks/${id}/move`, { stateId });

async function reports(c: Client, s: Setup, query = "") {
  const res = await call(c, "GET", `/api/projects/${s.p.id}/reports${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ProjectReports;
}

/** Runs the hourly job until it has caught up with every event (other test files' events included). */
async function catchUp() {
  for (let i = 0; i < 50; i++) if ((await updateReportSnapshots(env, Date.now(), 5)).events === 0) return;
}

describe("Section 16 calendar helpers", () => {
  it("weeks start on Monday in Winnipeg; percentiles use the nearest rank", () => {
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sunday → Monday before
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
    // 03:00 UTC on Monday is still Sunday evening in Winnipeg.
    expect(churchDate(Date.UTC(2026, 9, 26, 3))).toBe("2026-10-25");
    expect(percentiles([])).toEqual({ median: null, p85: null });
    expect(percentiles([4, 1, 3, 2])).toEqual({ median: 2.5, p85: 4 });
    expect(percentiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual({ median: 5.5, p85: 9 });
  });
});

describe("RPT-1 created vs completed and RPT-3 cycle time (hourly, incremental)", () => {
  let s: Setup;
  beforeAll(async () => {
    s = await setup();
  });

  it("counts creations and completions this week, and cycle time from first In Progress to Done", async () => {
    const a = await task(s, { title: "Finished" });
    await task(s, { title: "Still open" });
    await move(s, a.id, s.states.doing);
    await move(s, a.id, s.states.done);
    // Work began 3 days before it finished.
    await env.DB.prepare("UPDATE task_events SET at = at - ? WHERE task_id = ? AND field = 'state' AND new_value = ?").bind(3 * DAY, a.id, String(s.states.doing)).run();
    await catchUp();

    const r = await reports(s.admin, s);
    const thisWeek = r.throughput.at(-1)!;
    expect(r.throughput).toHaveLength(12);
    expect(thisWeek).toMatchObject({ created: 2, completed: 1 });
    const month = r.cycleTime.at(-1)!;
    expect(month).toMatchObject({ count: 1, medianDays: 3, p85Days: 3 });
  });

  it("a rerun of the job never counts an event twice; new events are added on the next run", async () => {
    await catchUp();
    await catchUp();
    expect((await reports(s.admin, s)).throughput.at(-1)).toMatchObject({ created: 2, completed: 1 });
    await task(s, { title: "Third" });
    expect((await reports(s.admin, s)).throughput.at(-1)!.created).toBe(2); // Not until the hourly run.
    await catchUp();
    expect((await reports(s.admin, s)).throughput.at(-1)!.created).toBe(3);
  });

  it("with a filter, counts only the matching tasks' events (straight from task_events)", async () => {
    await task(s, { title: "Urgent one", priority: "urgent" });
    const r = await reports(s.admin, s, "?priority=urgent");
    expect(r.filtered).toBe(true);
    expect(r.throughput.at(-1)).toMatchObject({ created: 1, completed: 0 });
  });

  it("the range picker gives 4, 12 or 26 weeks", async () => {
    expect((await reports(s.admin, s, "?weeks=4")).throughput).toHaveLength(4);
    expect((await reports(s.admin, s, "?weeks=26")).throughput).toHaveLength(26);
    expect((await reports(s.admin, s, "?weeks=7")).throughput).toHaveLength(12);
  });

  it("measures the hourly job on 1,000 new events (NFR-22 budget is 10 ms CPU)", async () => {
    await catchUp();
    const t = await task(s, { title: "Busy" });
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000)
       INSERT INTO task_events (task_id, actor_id, field, old_value, new_value, at)
       SELECT ?1, NULL, 'state', CAST(?2 AS TEXT), CAST(CASE WHEN i % 2 THEN ?3 ELSE ?2 END AS TEXT), ?4 + i FROM n`,
    )
      .bind(t.id, s.states.doing, s.states.done, Date.now())
      .run();
    const started = performance.now();
    const { events } = await updateReportSnapshots(env, Date.now(), 1);
    const elapsed = performance.now() - started;
    // Wall time in the test runtime, including D1 round trips; reported, not asserted against the CPU budget.
    console.log(`report snapshot job: ${events} events in ${elapsed.toFixed(1)} ms wall time`);
    expect(events).toBeGreaterThan(0);
  });
});

describe("RPT-1 current-state reports and RPT-2 workload", () => {
  it("status by column, overdue and due soon grouped by assignee, labels, components and milestones", async () => {
    const s = await setup();
    const label = await env.DB.prepare("INSERT INTO labels (project_id, name, colour) VALUES (?, 'Audio', 'blue') RETURNING id").bind(s.p.id).first<number>("id");
    const component = await env.DB.prepare("INSERT INTO components (project_id, name) VALUES (?, 'Stage') RETURNING id").bind(s.p.id).first<number>("id");
    const milestone = await env.DB.prepare("INSERT INTO milestones (project_id, name, target_date) VALUES (?, 'Christmas', '2026-12-24') RETURNING id").bind(s.p.id).first<number>("id");
    const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
    const late = await task(s, { title: "Late", dueDate: day(-3), assigneeId: s.contributor.userId, labelIds: [label], componentId: component, milestoneId: milestone, priority: "high" });
    await task(s, { title: "Soon", dueDate: day(2), labelIds: [label], milestoneId: milestone });
    await task(s, { title: "Far", dueDate: day(40) });
    const done = await task(s, { title: "Done", labelIds: [label], componentId: component, milestoneId: milestone });
    await move(s, done.id, s.states.done);

    const r = await reports(s.admin, s);
    expect(r.status.map((x) => [x.name, x.count])).toEqual([
      ["To Do", 3],
      ["Doing", 0],
      ["Done", 1],
    ]);
    const mine = r.atRisk.find((g) => g.assignee?.id === s.contributor.userId)!;
    expect(mine.tasks).toEqual([expect.objectContaining({ key: late.key, priority: "high" })]);
    expect(Math.abs(mine.tasks[0]!.daysOverdue - 3)).toBeLessThanOrEqual(1);
    expect(r.atRisk.find((g) => g.assignee === null)!.tasks.map((t) => t.title)).toEqual(["Soon"]);
    expect(r.labels).toEqual([{ id: label, name: "Audio", open: 2, completed: 1 }]);
    expect(r.components).toEqual([{ id: component, name: "Stage", open: 1, completed: 1 }]);
    expect(r.milestones[0]).toMatchObject({ name: "Christmas", total: 3, done: 1, openByPriority: { high: 1, medium: 1, urgent: 0, low: 0 } });
    expect(r.workload!.find((w) => w.assignee?.id === s.contributor.userId)).toEqual({ assignee: { id: s.contributor.userId, name: "Test contributor" }, open: 1, overdue: 1 });

    // Filters apply to the current-state reports too.
    const filtered = await reports(s.admin, s, `?assignee=${s.contributor.userId}`);
    expect(filtered.status.find((x) => x.name === "To Do")!.count).toBe(1);
  });

  it("workload is for Project Admins and App Admins; outsiders get 403", async () => {
    const s = await setup();
    expect((await reports(s.contributor, s)).workload).toBeNull();
    expect((await call(s.contributor, "GET", `/api/projects/${s.p.id}/reports/workload.csv`)).status).toBe(403);
    const outsider = await actorAs("contributor", (await createProject()).id);
    expect((await call(outsider, "GET", `/api/projects/${s.p.id}/reports`)).status).toBe(403);
  });
});

describe("RPT-4 CSV export", () => {
  it("each report downloads as CSV with the filters applied", async () => {
    const s = await setup();
    await task(s, { title: "One" });
    const res = await call(s.admin, "GET", `/api/projects/${s.p.id}/reports/status.csv`);
    expect(res.headers.get("Content-Disposition")).toMatch(new RegExp(`filename="${s.p.key}-status-\\d{4}-\\d{2}-\\d{2}\\.csv"`));
    expect((await res.text()).trim().split("\r\n")).toEqual(["column,category,tasks", "To Do,todo,1", "Doing,in_progress,0", "Done,done,0"]);
    expect((await call(s.admin, "GET", `/api/projects/${s.p.id}/reports/nope.csv`)).status).toBe(404);
    expect((await (await call(s.admin, "GET", `/api/projects/${s.p.id}/reports/throughput.csv?weeks=4`)).text()).trim().split("\r\n")).toHaveLength(5);
  });
});

describe("Section 16 church-wide reports (App Admin)", () => {
  it("one row per team project, workload across projects, and access and adoption; others get 403", async () => {
    const s = await setup();
    const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
    await task(s, { title: "Late", dueDate: day(-2), assigneeId: s.contributor.userId });
    const finished = await task(s, { title: "Finished" });
    await move(s, finished.id, s.states.done);
    const other = await setup();
    await call(other.admin, "POST", `/api/projects/${other.p.id}/tasks`, { title: "Elsewhere", assigneeId: other.contributor.userId });
    await addMember(other.p.id, s.contributor.userId, "contributor");
    await call(other.admin, "POST", `/api/projects/${other.p.id}/tasks`, { title: "Second project", assigneeId: s.contributor.userId });

    const appAdmin = await actorAs("appAdmin", s.p.id);
    const res = await call(appAdmin, "GET", "/api/reports/church?weeks=4");
    expect(res.status).toBe(200);
    const r = (await res.json()) as ChurchReports;
    expect(r.overview.find((p) => p.id === s.p.id)).toMatchObject({ open: 1, overdue: 1, completedThisMonth: 1 });
    expect(r.workload.find((w) => w.person.id === s.contributor.userId)).toMatchObject({ open: 2, overdue: 1, projects: 2 });
    expect(r.adoption.activeByWeek).toHaveLength(4);
    expect(r.adoption.activeByWeek.at(-1)!.people).toBeGreaterThanOrEqual(2);
    expect(r.overview.some((p) => p.key === "HUB")).toBe(false);

    expect((await call(s.admin, "GET", "/api/reports/church")).status).toBe(403);
    const csv = await call(appAdmin, "GET", "/api/reports/church/overview.csv");
    expect((await csv.text()).split("\r\n")[0]).toBe("project,key,archived,open,overdue,completed_this_month");
    expect((await call(s.admin, "GET", "/api/reports/church/workload.csv")).status).toBe(403);
  });
});
