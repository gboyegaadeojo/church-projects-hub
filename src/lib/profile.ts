import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { MeResponse } from "../../shared/auth";
import { toast } from "../components/ui/Toast";
import { getThemePreference, setThemePreference, type ThemePreference } from "../theme/theme";
import { api } from "./api";
import { SESSION_QUERY_KEY, type SessionState } from "./session";

// Theme on the profile (section 9, carried over from Stage 1). Signed in, the profile's choice wins and
// is also written to this browser, which keeps it for signed-out pages and the next first paint.

const SAVE_FAILED = "We couldn't save this change. Check your connection and try again.";

/** Applies the profile's theme whenever the signed-in person's data arrives or changes. */
export function useProfileTheme(theme: ThemePreference | undefined) {
  useEffect(() => {
    if (theme && theme !== getThemePreference()) setThemePreference(theme);
  }, [theme]);
}

/** Changes the theme now and saves it to the profile; puts the old one back if the save fails. */
export function useSaveTheme(me: MeResponse) {
  const queryClient = useQueryClient();
  return async (next: ThemePreference) => {
    const previous = getThemePreference();
    if (next === previous) return;
    setThemePreference(next);
    try {
      await api("/api/me/preferences", { method: "PATCH", body: { theme: next }, csrfToken: me.csrfToken });
      queryClient.setQueryData<SessionState>(SESSION_QUERY_KEY, (state) =>
        state?.kind === "signed-in" ? { ...state, me: { ...state.me, user: { ...state.me.user, theme: next } } } : state,
      );
    } catch {
      setThemePreference(previous);
      toast({ variant: "error", title: SAVE_FAILED });
    }
  };
}
