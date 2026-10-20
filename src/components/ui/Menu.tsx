import type { LucideIcon } from "lucide-react";
import { DropdownMenu, Popover as RadixPopover } from "radix-ui";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Icon } from "./Icon";
import { usePortalContainer } from "./portal";

// Menus and popovers (section 15): close on Escape, click outside and selection; arrow keys move
// between items; they flip and shift to stay inside the viewport. Focus returns to the trigger.
// Route changes unmount the page that owns the menu, which closes it.

const floatingClasses =
  "z-50 rounded-control border border-line bg-elevated text-ink shadow-floating " +
  "data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({ className, children, ...rest }: ComponentPropsWithoutRef<typeof DropdownMenu.Content>) {
  const container = usePortalContainer();
  return (
    <DropdownMenu.Portal container={container}>
      <DropdownMenu.Content
        align="end"
        sideOffset={4}
        collisionPadding={8}
        className={cn(floatingClasses, "min-w-56 p-1", className)}
        {...rest}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

type MenuItemProps = ComponentPropsWithoutRef<typeof DropdownMenu.Item> & {
  icon?: LucideIcon;
  /** Destructive items are red and should open a ConfirmDialog. */
  destructive?: boolean;
};

export function MenuItem({ icon, destructive, className, children, ...rest }: MenuItemProps) {
  return (
    <DropdownMenu.Item
      className={cn(
        "flex min-h-touch cursor-default select-none items-center gap-3 rounded-chip px-3 text-body outline-none",
        "data-highlighted:bg-hover data-disabled:text-ink-disabled",
        destructive && "text-danger-ink",
        className,
      )}
      {...rest}
    >
      {icon && <Icon icon={icon} />}
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="px-3 pt-2 pb-1 text-label text-ink-2">{children}</DropdownMenu.Label>;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-line" />;
}

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverClose = RadixPopover.Close;
/** Positions the popover against something other than its trigger (e.g. an editor toolbar). */
export const PopoverAnchor = RadixPopover.Anchor;

export function PopoverContent({ className, children, ...rest }: ComponentPropsWithoutRef<typeof RadixPopover.Content>) {
  const container = usePortalContainer();
  return (
    <RadixPopover.Portal container={container}>
      <RadixPopover.Content
        sideOffset={4}
        collisionPadding={8}
        className={cn(floatingClasses, "w-80 max-w-[calc(100vw-2*var(--spacing-component))] p-4", className)}
        {...rest}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}
