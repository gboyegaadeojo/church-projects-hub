import { beforeAll, describe, expect, it } from "vitest";
import { EMPTY_FILTER, filterFromSearch, filterToSearch, matchesFilter, type SavedFilter, taskFilter } from "../shared/filters";
import { rankBetween } from "../shared/rank";
import { TASK_CONFIRM } from "../shared/tasks";
import { call, type Client } from "./helpers/auth";
import { actorAs, auditFor, createProject, MATRIX_ROLES, type MatrixRole } from "./helpers/fixtures";

// ORG-5 saved filters against the real API and D1, and the filter and rank rules shared with the app.

let project: { id: number };
let actors: Record<MatrixRole, Client>;
const query = { ...EMPTY_FILTER, priorities: ["urgent", "high"] };

beforeAll(async () => {
  project = await createProject();
  actors = {} as Record<MatrixRole, Client>;
  for (const role of MATRIX_ROLES) actors[role] = await actorAs(role, project.id);
});

async function list(client: Client) {
  const res = await call(client, "GET", `/api/projects/${project.id}/saved-filters`);
  return ((await res.json()) as { filters: SavedFilter[] }).filters;
}

describe("ORG-5 Saved filters, private or shared to the project", () => {
  it("a private filter is seen only by its owner; a shared one by everyone in the project", async () => {
    let res = await call(actors.viewer, "POST", `/api/projects/${project.id}/saved-filters`, { name: "My urgent", query });
    expect(res.status).toBe(201);
    // Viewers can't share (sharing needs task edit rights).
    res = await call(actors.viewer, "POST", `/api/projects/${project.id}/saved-filters`, { name: "Everyone", query, shared: true });
    expect(res.status).toBe(403);
    res = await call(actors.contributor, "POST", `/api/projects/${project.id}/saved-filters`, { name: "Team urgent", query, shared: true });
    expect(res.status).toBe(201);

    expect((await list(actors.viewer)).map((f) => f.name).sort()).toEqual(["My urgent", "Team urgent"]);
    expect((await list(actors.projectAdmin)).map((f) => f.name)).toEqual(["Team urgent"]);
    expect((await list(actors.projectAdmin))[0]!.query).toEqual(query);
    expect((await call(actors.pending, "GET", `/api/projects/${project.id}/saved-filters`)).status).toBe(403);
  });

  it("deleting needs confirmation; owners delete theirs, Project Admins can remove shared ones; audited", async () => {
    const mine = (await (await call(actors.contributor, "POST", `/api/projects/${project.id}/saved-filters`, { name: "Mine", query })).json()) as {
      filter: SavedFilter;
    };
    const shared = (await (
      await call(actors.contributor, "POST", `/api/projects/${project.id}/saved-filters`, { name: "Shared", query, shared: true })
    ).json()) as { filter: SavedFilter };
    const confirm = { "X-Confirm-Action": TASK_CONFIRM.deleteSavedFilter };
    expect((await call(actors.contributor, "DELETE", `/api/saved-filters/${mine.filter.id}`)).status).toBe(428);
    // Someone else's private filter is invisible to them: 404.
    expect((await call(actors.projectAdmin, "DELETE", `/api/saved-filters/${mine.filter.id}`, undefined, confirm)).status).toBe(404);
    expect((await call(actors.viewer, "DELETE", `/api/saved-filters/${shared.filter.id}`, undefined, confirm)).status).toBe(403);
    expect((await call(actors.projectAdmin, "DELETE", `/api/saved-filters/${shared.filter.id}`, undefined, confirm)).status).toBe(200);
    expect((await call(actors.contributor, "DELETE", `/api/saved-filters/${mine.filter.id}`, undefined, confirm)).status).toBe(200);
    expect(await auditFor("saved_filter.deleted", shared.filter.id)).toHaveLength(1);
  });

  it("rejects malformed filters", async () => {
    const bad = { name: "x", query: { ...EMPTY_FILTER, priorities: ["critical"] } };
    expect((await call(actors.contributor, "POST", `/api/projects/${project.id}/saved-filters`, bad)).status).toBe(400);
  });
});

describe("Section 11.2 filters", () => {
  const task = { assigneeId: 3, labelIds: [5, 6], priority: "high" as const, scope: "in_scope" as const };
  it("any value within a group, every group across", () => {
    expect(matchesFilter(task, EMPTY_FILTER)).toBe(true);
    expect(matchesFilter(task, { ...EMPTY_FILTER, assignees: [3, "none"] })).toBe(true);
    expect(matchesFilter({ ...task, assigneeId: null }, { ...EMPTY_FILTER, assignees: ["none"] })).toBe(true);
    expect(matchesFilter(task, { ...EMPTY_FILTER, labels: [6], priorities: ["high"] })).toBe(true);
    expect(matchesFilter(task, { ...EMPTY_FILTER, labels: [6], priorities: ["low"] })).toBe(false);
    expect(matchesFilter(task, { ...EMPTY_FILTER, scopes: ["parked"] })).toBe(false);
  });

  it("v4.6 type, epic, due and search filters; the secondary assignee matches a person", () => {
    const card = {
      assigneeId: 3,
      secondaryAssigneeId: 4,
      labelIds: [],
      priority: "high" as const,
      scope: "in_scope" as const,
      type: "bug" as const,
      epicId: 9,
      dueDate: "2026-10-18",
      title: "Replace mic batteries",
      key: "MEDIA-7",
    };
    const today = "2026-10-20";
    expect(matchesFilter(card, { ...EMPTY_FILTER, assignees: [4] })).toBe(true);
    expect(matchesFilter(card, { ...EMPTY_FILTER, types: ["task"] })).toBe(false);
    expect(matchesFilter(card, { ...EMPTY_FILTER, epics: [9] })).toBe(true);
    expect(matchesFilter(card, { ...EMPTY_FILTER, epics: ["none"] })).toBe(false);
    expect(matchesFilter(card, { ...EMPTY_FILTER, due: ["overdue"] }, today)).toBe(true);
    expect(matchesFilter(card, { ...EMPTY_FILTER, due: ["none"] }, today)).toBe(false);
    expect(matchesFilter({ ...card, dueDate: "2026-10-25" }, { ...EMPTY_FILTER, due: ["week"] }, today)).toBe(true);
    expect(matchesFilter({ ...card, dueDate: "2026-12-25" }, { ...EMPTY_FILTER, due: ["week"] }, today)).toBe(false);
    expect(matchesFilter(card, { ...EMPTY_FILTER, q: "MIC media-7" })).toBe(true);
    expect(matchesFilter(card, { ...EMPTY_FILTER, q: "projector" })).toBe(false);
    // A filter saved before v4.6 still loads, with the new fields empty.
    expect(taskFilter.parse({ assignees: [3], labels: [], priorities: [], scopes: [] })).toEqual({ ...EMPTY_FILTER, assignees: [3] });
  });

  it("round-trips through the URL and keeps other parameters", () => {
    const f = {
      ...EMPTY_FILTER,
      assignees: [3, "none" as const],
      labels: [5],
      priorities: ["urgent" as const],
      scopes: ["parked" as const],
      types: ["bug" as const],
      epics: [12, "none" as const],
      due: ["overdue" as const],
      q: "mic batteries",
    };
    const params = filterToSearch(f, new URLSearchParams("view=list&task=MEDIA-4"));
    expect(params.get("view")).toBe("list");
    expect(params.get("task")).toBe("MEDIA-4");
    expect(filterFromSearch(params)).toEqual(f);
    expect(filterFromSearch(new URLSearchParams("priority=bogus"))).toEqual(EMPTY_FILTER);
  });
});

describe("TASK-2 card order", () => {
  it("ranks sort between their neighbours and recover from out-of-order neighbours", () => {
    const a = rankBetween(null, null);
    const c = rankBetween(a, null);
    const b = rankBetween(a, c);
    expect([c, a, b].sort()).toEqual([a, b, c]);
    expect(rankBetween(c, a) > c).toBe(true);
  });
});
