import type { Notice } from "../notify";

// v4.7 Blocked work: a column can be marked as blocking. Moving a task into one needs a reason, which is kept on the
// task (with who and when), recorded in its history and sent to the people on it; moving it out clears it. The same
// rule applies to every way a task changes column: drag and drop, the Move menu, the status field, bulk edit and
// creating a task straight into the column.

export type BlockTransition = { into: boolean; out: boolean; stays: boolean };

/** Whether moving from one column to another enters, leaves, or stays in a blocking column. */
export async function blockTransition(env: Pick<Env, "DB">, fromStateId: number | null, toStateId: number): Promise<BlockTransition> {
  const { results } = await env.DB.prepare("SELECT id, blocks FROM workflow_states WHERE id IN (?1, ?2)")
    .bind(fromStateId ?? 0, toStateId)
    .all<{ id: number; blocks: number }>();
  const blocks = (id: number | null) => results.some((r) => r.id === id && r.blocks === 1);
  const from = blocks(fromStateId);
  const to = blocks(toStateId);
  return { into: to && !from, out: from && !to, stays: from && to };
}

/** Column values for entering (reason) or leaving (null) the blocked state. */
export function blockedColumns(reason: string | null, actorId: number, now: number): [string, unknown][] {
  return [
    ["blocked_reason", reason],
    ["blocked_at", reason === null ? null : now],
    ["blocked_by", reason === null ? null : actorId],
  ];
}

/** "Blocked" to everyone on the task except whoever blocked it. */
export function blockedNotice(opts: {
  task: { id: number } | { newInProject: number };
  projectId: number;
  people: (number | null | undefined)[];
  actorId: number;
  reason: string;
}): Notice {
  return {
    type: "task.blocked",
    recipients: [...new Set(opts.people.filter((id): id is number => typeof id === "number" && id !== opts.actorId))],
    actorId: opts.actorId,
    task: opts.task,
    projectId: opts.projectId,
    payload: { reason: opts.reason },
  };
}
