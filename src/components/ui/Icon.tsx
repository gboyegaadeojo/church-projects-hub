import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

// The one icon family is Lucide (section 9): 20 px, 1.5 px stroke.
// CSS size comes from the --spacing-icon tokens (size-icon / size-icon-sm). Lucide also needs the
// pixel size to keep the stroke at exactly 1.5 px (absoluteStrokeWidth); these mirror those tokens.
const STROKE_WIDTH = 1.5;
const PIXEL_SIZE = { md: 20, sm: 16 } as const;

type IconProps = {
  icon: LucideIcon;
  size?: "md" | "sm";
  className?: string;
  /** Only for a standalone meaningful icon. Icons next to text are decorative and stay hidden. */
  label?: string;
};

export function Icon({ icon: Glyph, size = "md", className, label }: IconProps) {
  return (
    <Glyph
      className={cn("shrink-0", size === "md" ? "size-icon" : "size-icon-sm", className)}
      size={PIXEL_SIZE[size]}
      strokeWidth={STROKE_WIDTH}
      absoluteStrokeWidth
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      focusable="false"
    />
  );
}
