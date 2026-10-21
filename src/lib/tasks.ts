import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type SavedFilter, type SavedFilterBody, savedFiltersResponse } from "../../shared/filters";
import { rankBetween } from "../../shared/rank";
import {
  type BoardResponse,
  boardResponse,
  type BulkEditBody,
  type CreateTaskBody,
  type Person,
  TASK_COPY,
  type TaskCard,
  type TaskDetail,
  taskResponse,
} from "../../shared/tasks";
import { toast } from "../components/ui/Toast";
import { api } from "./api";

// Tasks on the client: the board query and its mutations. Refetched on focus, never polled (section 5).

export const boardKey = (projectId: number) => ["board", projectId] as const;

export function useBoard(projectId: number | undefined) {
  return useQuery({
    queryKey: boardKey(projectId ?? 0),
    enabled: projectId !== undefined,
    queryFn: async () => boardResponse.parse(await api(`/api/projects/${projectId}/board`)),
  });
}

/** Everyone a card can name: members first, then anyone else on a task (people who have left the project). */
export function peopleById(board: Pick<BoardResponse, "members" | "people">): Map<number, Person> {
  const map = new Map<number, Person>();
  for (const p of board.people) map.set(p.id, p);
  for (const m of board.members) map.set(m.id, m);
  return map;
}

/** Cards of one column in board order. */
export function columnCards(tasks: TaskCard[], stateId: number): TaskCard[] {
  return tasks.filter((t) => t.stateId === stateId).sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
}

export type MoveInput = { task: TaskCard; stateId: number; afterId: number | null; beforeId: number | null };

/**
 * Card moves are optimistic (NFR-12): the card moves at once and goes back with
 * "Couldn't move this task. The board has been restored." if the server refuses.
 */
export function useMoveTask(projectId: number, csrfToken: string) {
  const queryClient = useQueryClient();
  const key = boardKey(projectId);
  return useMutation({
    mutationFn: ({ task, stateId, afterId, beforeId }: MoveInput) =>
      api<{ task: TaskCard }>(`/api/tasks/${task.id}/move`, { method: "POST", body: { stateId, afterId, beforeId }, csrfToken }),
    onMutate: async ({ task, stateId, afterId, beforeId }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<BoardResponse>(key);
      if (previous) {
        const rankOf = (id: number | null) => (id === null ? null : (previous.tasks.find((t) => t.id === id)?.rank ?? null));
        let after = rankOf(afterId);
        const before = rankOf(beforeId);
        if (after === null && before === null) {
          const last = columnCards(previous.tasks, stateId).filter((t) => t.id !== task.id).at(-1);
          after = last?.rank ?? null;
        }
        const rank = rankBetween(after, before);
        queryClient.setQueryData<BoardResponse>(key, {
          ...previous,
          tasks: previous.tasks.map((t) => (t.id === task.id ? { ...t, stateId, rank } : t)),
        });
      }
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast({ variant: "error", title: TASK_COPY.moveFailed });
    },
    onSuccess: ({ task }) => {
      queryClient.setQueryData<BoardResponse>(key, (current) =>
        current ? { ...current, tasks: current.tasks.map((t) => (t.id === task.id ? task : t)) } : current,
      );
    },
  });
}

export function useCreateTask(projectId: number, csrfToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskBody) =>
      api(`/api/projects/${projectId}/tasks`, { method: "POST", body, csrfToken }).then((r) => taskResponse.parse(r).task),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardKey(projectId) }),
  });
}

export function useBulkEdit(projectId: number, csrfToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkEditBody) => api<{ updated: number }>(`/api/projects/${projectId}/tasks/bulk`, { method: "POST", body, csrfToken }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: boardKey(projectId) }),
  });
}

/** Writes a fresh task detail back into the board's card, so the board matches without a refetch. */
export function syncCardFromDetail(queryClient: ReturnType<typeof useQueryClient>, detail: TaskDetail) {
  queryClient.setQueryData<BoardResponse>(boardKey(detail.projectId), (current) => {
    if (!current) return current;
    const card: TaskCard = {
      id: detail.id,
      key: detail.key,
      number: detail.number,
      title: detail.title,
      type: detail.type,
      stateId: detail.stateId,
      priority: detail.priority,
      scope: detail.scope,
      assigneeId: detail.assigneeId,
      secondaryAssigneeId: detail.secondaryAssigneeId,
      reporterId: detail.reporterId,
      dueDate: detail.dueDate,
      labelIds: detail.labelIds,
      componentId: detail.componentId,
      epicId: detail.epicId,
      milestoneId: detail.milestoneId,
      rank: detail.rank,
      version: detail.version,
      subtasksDone: detail.subtasks.filter((s) => s.done).length,
      subtasksTotal: detail.subtasks.length,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    };
    const exists = current.tasks.some((t) => t.id === card.id);
    return { ...current, tasks: exists ? current.tasks.map((t) => (t.id === card.id ? card : t)) : [...current.tasks, card] };
  });
}

// ---- Saved filters (ORG-5)

export const savedFiltersKey = (projectId: number) => ["saved-filters", projectId] as const;

export function useSavedFilters(projectId: number) {
  return useQuery({
    queryKey: savedFiltersKey(projectId),
    queryFn: async () => savedFiltersResponse.parse(await api(`/api/projects/${projectId}/saved-filters`)).filters,
  });
}

export function useSaveFilter(projectId: number, csrfToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SavedFilterBody) =>
      api<{ filter: SavedFilter }>(`/api/projects/${projectId}/saved-filters`, { method: "POST", body, csrfToken }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: savedFiltersKey(projectId) }),
  });
}
