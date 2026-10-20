import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { BELL_LIMIT, BELL_MAX_AGE_MS, BELL_REFRESH_MS, notificationsResponse } from "../../shared/notifications";
import { api } from "./api";

// The bell's data (section 11.8). The unread count arrives on every API response (X-Unread-Count), and the
// list refreshes on tab focus and every 2 minutes while the tab is visible — never while hidden (section 5).

let unread: number | null = null;
const listeners = new Set<() => void>();

export function setUnread(n: number) {
  if (!Number.isFinite(n) || n === unread) return;
  unread = n;
  for (const l of listeners) l();
}

export function useUnread(): number | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => unread,
    () => null,
  );
}

export const BELL_KEY = ["notifications", "bell"] as const;

export function useBell() {
  return useQuery({
    queryKey: BELL_KEY,
    queryFn: async () => {
      const data = notificationsResponse.parse(await api(`/api/notifications?limit=${BELL_LIMIT}&since=${Date.now() - BELL_MAX_AGE_MS}`));
      setUnread(data.unread);
      return data;
    },
    refetchInterval: BELL_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useMarkRead(csrfToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number | "all") =>
      api(id === "all" ? "/api/notifications/read-all" : `/api/notifications/${id}/read`, { method: "POST", csrfToken }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

/** "5 min ago", "yesterday", "3 days ago". */
export function relativeTime(at: number, now: number = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const s = Math.round((at - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(Math.round(s), "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(at);
}
