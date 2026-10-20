import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RichTextDoc } from "../../shared/richtext";
import { conflictResponse, type Subtask, type TaskDetail, taskResponse, type UpdateTaskBody } from "../../shared/tasks";
import { api, ApiError } from "./api";
import { boardKey, syncCardFromDetail } from "./tasks";

// One task's detail (section 11.3): loading it, inline saves with optimistic concurrency (NFR-10),
// subtasks, comments and watching. Every save writes the result back into the board's card.

export const taskKeyOf = (key: string) => ["task", key.toUpperCase()] as const;

export function useTaskDetail(key: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: taskKeyOf(key ?? ""),
    enabled: !!key,
    queryFn: async () => {
      const task = taskResponse.parse(await api(`/api/tasks/by-key/${encodeURIComponent(key!)}`)).task;
      syncCardFromDetail(queryClient, task);
      return task;
    },
    retry: (count, err) => !(err instanceof ApiError && (err.status === 403 || err.status === 404)) && count < 2,
  });
}

/** Thrown when the task changed since it was loaded; carries the current task for review. */
export class TaskConflict extends Error {
  constructor(readonly current: TaskDetail) {
    super("conflict");
  }
}

function useStore() {
  const queryClient = useQueryClient();
  return (task: TaskDetail) => {
    queryClient.setQueryData(taskKeyOf(task.key), task);
    syncCardFromDetail(queryClient, task);
  };
}

export function useUpdateTask(csrfToken: string) {
  const store = useStore();
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: UpdateTaskBody }) => {
      try {
        return taskResponse.parse(await api(`/api/tasks/${id}`, { method: "PATCH", body, csrfToken })).task;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const parsed = conflictResponse.safeParse(err.body);
          if (parsed.success) throw new TaskConflict(parsed.data.task);
        }
        throw err;
      }
    },
    onSuccess: store,
    // Show the latest version at once, so the person reviews what changed before saving theirs again.
    onError: (err) => {
      if (err instanceof TaskConflict) store(err.current);
    },
  });
}

/** Subtask writes return the whole checklist; the task and the card's progress follow. */
export function useSubtasks(task: TaskDetail, csrfToken: string) {
  const queryClient = useQueryClient();
  const store = useStore();
  const apply = (subtasks: Subtask[]) => store({ ...queryClient.getQueryData<TaskDetail>(taskKeyOf(task.key))!, subtasks });
  return {
    add: (title: string) =>
      api<{ subtasks: Subtask[] }>(`/api/tasks/${task.id}/subtasks`, { method: "POST", body: { title }, csrfToken }).then((r) => apply(r.subtasks)),
    update: (id: number, body: Partial<Pick<Subtask, "title" | "done" | "position">>) =>
      api<{ subtasks: Subtask[] }>(`/api/subtasks/${id}`, { method: "PATCH", body, csrfToken }).then((r) => apply(r.subtasks)),
    remove: (id: number, headers: Record<string, string>) =>
      api<{ subtasks: Subtask[] }>(`/api/subtasks/${id}`, { method: "DELETE", csrfToken, headers }).then((r) => apply(r.subtasks)),
  };
}

export function useComments(task: TaskDetail, csrfToken: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: taskKeyOf(task.key) });
  return {
    add: (body: RichTextDoc) => api(`/api/tasks/${task.id}/comments`, { method: "POST", body: { body }, csrfToken }).then(refresh),
    edit: (id: number, body: RichTextDoc) => api(`/api/comments/${id}`, { method: "PATCH", body: { body }, csrfToken }).then(refresh),
    remove: (id: number, headers: Record<string, string>) => api(`/api/comments/${id}`, { method: "DELETE", csrfToken, headers }).then(refresh),
  };
}

export function useWatch(task: TaskDetail, meId: number, csrfToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (watch: boolean) => api(`/api/tasks/${task.id}/watch`, { method: watch ? "PUT" : "DELETE", csrfToken }),
    onSuccess: (_r, watch) =>
      queryClient.setQueryData<TaskDetail>(taskKeyOf(task.key), (t) =>
        t ? { ...t, watcherIds: watch ? [...new Set([...t.watcherIds, meId])] : t.watcherIds.filter((id) => id !== meId) } : t,
      ),
  });
}

export function useDeleteTask(task: TaskDetail, csrfToken: string) {
  const queryClient = useQueryClient();
  return async (headers: Record<string, string>) => {
    await api(`/api/tasks/${task.id}`, { method: "DELETE", csrfToken, headers });
    queryClient.removeQueries({ queryKey: taskKeyOf(task.key) });
    await queryClient.invalidateQueries({ queryKey: boardKey(task.projectId) });
  };
}
