import { useSyncExternalStore } from "react";

// Theme preference (section 9): Light, Dark or System. Persisted in localStorage.
// The inline script in index.html applies the saved choice before first paint; keep the key in sync.
export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "cph-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const listeners = new Set<() => void>();
let preference: ThemePreference = readStoredPreference();

function readStoredPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage blocked (private mode, policy): fall back to System.
  }
  return "system";
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === "system" ? systemTheme() : pref;
}

function applyTheme() {
  const root = document.documentElement;
  const next = resolveTheme(preference);
  if (root.getAttribute("data-theme") === next) return;
  // Suppress transitions for one frame so colours swap instantly without animating.
  root.classList.add("theme-switching");
  root.setAttribute("data-theme", next);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
}

function emit() {
  for (const listener of listeners) listener();
}

export function setThemePreference(next: ThemePreference) {
  preference = next;
  try {
    if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Not persisted, but still applied for this visit.
  }
  applyTheme();
  emit();
}

export function getThemePreference(): ThemePreference {
  return preference;
}

if (typeof window !== "undefined") {
  // Follow the OS while on System; pick up changes made in another tab.
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    if (preference === "system") {
      applyTheme();
      emit();
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    preference = readStoredPreference();
    applyTheme();
    emit();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  const pref = useSyncExternalStore(subscribe, getThemePreference);
  return { preference: pref, resolved: resolveTheme(pref), setPreference: setThemePreference };
}
