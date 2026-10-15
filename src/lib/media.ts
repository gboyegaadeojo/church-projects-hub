import { useSyncExternalStore } from "react";

// Section 12 breakpoints: mobile 360–767 px, tablet 768–1023 px, desktop ≥ 1024 px.
// Layout is CSS (md: / lg:); this is only for behaviour that differs, like the tablet's collapsible sidebar.
export const TABLET_QUERY = "(min-width: 768px) and (max-width: 1023.98px)";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
