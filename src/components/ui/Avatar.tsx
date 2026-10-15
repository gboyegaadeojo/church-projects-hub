import { useState } from "react";
import { cn } from "../../lib/cn";

// A person's Google photo, or their initials when there is none or it fails to load.
// Decorative by default: the name is always shown or announced next to it.

const sizes = { sm: "size-8 text-label", md: "size-10 text-secondary", lg: "size-12 text-body" } as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [parts[0]?.[0]];
  return letters.join("").toUpperCase() || "?";
}

export function Avatar({ name, url, size = "md", className }: { name: string; url: string | null; size?: keyof typeof sizes; className?: string }) {
  const [failed, setFailed] = useState(false);
  const box = cn("inline-flex shrink-0 items-center justify-center rounded-full bg-hover font-medium text-ink-2", sizes[size], className);
  if (url && !failed) {
    return <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={cn(box, "object-cover")} />;
  }
  return (
    <span aria-hidden="true" className={box}>
      {initials(name)}
    </span>
  );
}
