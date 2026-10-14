import { LoaderCircle, type LucideIcon } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { cn } from "../../lib/cn";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

// Buttons (section 15). Every variant has hover, focus, pressed, disabled and loading states (section 10).
// Destructive buttons are red AND carry the verb in their label (and usually an icon), never colour alone.
export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

const base =
  "relative inline-flex min-h-touch select-none items-center justify-center gap-2 rounded-control text-secondary font-medium " +
  "transition-[background-color,border-color,color,transform] duration-(--duration-micro) ease-out " +
  "state-pressed:scale-(--scale-pressed) disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-on-accent state-hover:bg-accent-hover state-pressed:bg-accent-pressed " +
    "disabled:bg-disabled disabled:text-ink-disabled disabled:border disabled:border-line",
  secondary:
    "border border-line-strong bg-card text-ink state-hover:bg-hover state-pressed:bg-pressed " +
    "disabled:bg-disabled disabled:text-ink-disabled disabled:border-line",
  ghost: "text-ink state-hover:bg-hover state-pressed:bg-pressed disabled:text-ink-disabled",
  destructive:
    "bg-danger text-on-danger state-hover:bg-danger-hover state-pressed:bg-danger-pressed " +
    "disabled:bg-disabled disabled:text-ink-disabled disabled:border disabled:border-line",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** Leading icon. Replaced by a spinner while loading. */
  icon?: LucideIcon;
  /** Shows a spinner inside the button and ignores clicks, but keeps focus and the label. */
  loading?: boolean;
  fullWidth?: boolean;
  /** Square, no padding. Use IconButton rather than setting this directly. */
  iconOnly?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", icon, loading = false, fullWidth, iconOnly, className, children, type = "button", onClick, ...rest },
  ref,
) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      ref={ref}
      type={type}
      className={cn(base, variants[variant], iconOnly ? "w-touch" : "px-4", fullWidth && "w-full", className)}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={handleClick}
      {...rest}
    >
      {loading ? (
        <Icon icon={LoaderCircle} className="animate-spin" />
      ) : (
        icon && <Icon icon={icon} />
      )}
      {children}
    </button>
  );
});

export type IconButtonProps = Omit<ButtonProps, "children" | "icon" | "fullWidth" | "iconOnly"> & {
  icon: LucideIcon;
  /** Accessible name, also shown as the tooltip (section 9). */
  label: string;
};

/** Square icon-only button with an accessible name and a tooltip. Defaults to the quiet ghost style. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = "ghost", ...rest },
  ref,
) {
  return (
    <Tooltip content={label}>
      <Button ref={ref} variant={variant} icon={icon} aria-label={label} iconOnly {...rest} />
    </Tooltip>
  );
});
