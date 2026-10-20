import { useSyncExternalStore } from "react";

// Online state (section 11.10, NFR-20). Reconnecting restores writes without a reload: everything that reads
// this re-renders, and TanStack Query refetches on reconnect.

export const OFFLINE_COPY = {
  banner: "You're offline. Showing your last saved view — changes are disabled until you reconnect.",
  writeDisabled: "Not available offline.",
} as const;

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true);
}
