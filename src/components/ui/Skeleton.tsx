import { useEffect, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

// Skeletons (section 15): match the content's rough shape, subtle shimmer (none with reduced motion),
// never shown for requests under 200 ms, and removed only when the content is ready.
export const SKELETON_DELAY_MS = 200;

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden rounded-chip bg-skeleton",
        "after:absolute after:inset-0 after:animate-shimmer after:bg-linear-to-r after:from-transparent after:via-skeleton-shine after:to-transparent after:content-[''] motion-reduce:after:hidden",
        className,
      )}
    />
  );
}

/** True once `active` has stayed true for the delay, so fast requests never flash a skeleton. */
export function useDelayedFlag(active: boolean, delayMs = SKELETON_DELAY_MS): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return active && shown;
}

type LoadingRegionProps = {
  loading: boolean;
  /** Skeleton shaped like the content. */
  skeleton: ReactNode;
  /** What screen readers hear while loading, e.g. "Loading tasks". */
  label: string;
  children: ReactNode;
};

/** Shows nothing for the first 200 ms, then the skeleton, then the content once loading ends. */
export function LoadingRegion({ loading, skeleton, label, children }: LoadingRegionProps) {
  const showSkeleton = useDelayedFlag(loading);
  return (
    <div aria-busy={loading || undefined}>
      {loading ? (
        <>
          <span className="sr-only" role="status">
            {label}
          </span>
          {showSkeleton && skeleton}
        </>
      ) : (
        children
      )}
    </div>
  );
}
