import { useSyncExternalStore } from "react";

// NFR-18: when the API reports the database unavailable, the whole app shows the maintenance page.

let down = false;
const listeners = new Set<() => void>();

export function setMaintenance(value: boolean) {
  if (down === value) return;
  down = value;
  for (const l of listeners) l();
}

export function useMaintenance(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => down,
    () => false,
  );
}

export const MAINTENANCE_COPY = "The hub is temporarily unavailable. We're aware and working on it.";
