import { cn } from "../../lib/cn";

// Placeholder for the church logo (sections 11.6, 11.15) until the real file is supplied: an "IFC" mark
// beside the app name. Swap the mark for the logo image when it arrives; keep the text for screen readers.

export const APP_NAME = "Church Projects Hub";

export function BrandMark({ showName = true, className }: { showName?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <span
        aria-hidden="true"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-accent text-label font-semibold tracking-wide text-on-accent"
      >
        IFC
      </span>
      {showName ? (
        <span className="text-body font-semibold text-ink">{APP_NAME}</span>
      ) : (
        <span className="sr-only">{APP_NAME}</span>
      )}
    </span>
  );
}
