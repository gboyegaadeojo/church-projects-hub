import { useState } from "react";
import { cn } from "../../lib/cn";

// A person's Google photo, or their initials on a colour of their own when there is none or it fails to load.
// Decorative by default: the name is always shown or announced next to it.

const sizes = { xs: "size-6 text-micro", sm: "size-8 text-label", md: "size-10 text-secondary", lg: "size-12 text-body" } as const;

/** The vivid backgrounds (white text ≥ 4.5:1 on each, contrast.test.ts). Full class names so Tailwind finds them. */
const COLOURS = ["bg-vivid-blue", "bg-vivid-purple", "bg-vivid-teal", "bg-vivid-orange", "bg-vivid-pink", "bg-vivid-green", "bg-vivid-indigo", "bg-vivid-red"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [parts[0]?.[0]];
  return letters.join("").toUpperCase() || "?";
}

/** The same name always gets the same colour. */
function colourFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLOURS[hash % COLOURS.length]!;
}

export function Avatar({ name, url, size = "md", className }: { name: string; url: string | null; size?: keyof typeof sizes; className?: string }) {
  const [failed, setFailed] = useState(false);
  const box = cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", sizes[size], className);
  if (url && !failed) {
    return <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={cn(box, "object-cover")} />;
  }
  return (
    <span aria-hidden="true" className={cn(box, colourFor(name), "text-on-vivid")}>
      {initials(name)}
    </span>
  );
}
