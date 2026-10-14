import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import { useRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { IconButton } from "./Button";
import { usePortalContainer } from "./portal";

// Dialogs and sheets (section 15): focus is trapped while open, Escape and clicking the dimmed
// overlay close, and focus returns to the trigger. Radix Dialog provides the first two; Radix only
// returns focus to its own <DialogTrigger>, so useReturnFocus covers dialogs opened from code.
export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

type ContentProps = Omit<ComponentPropsWithoutRef<typeof RadixDialog.Content>, "title"> & {
  title: string;
  description?: ReactNode;
  /** Buttons row at the bottom. */
  footer?: ReactNode;
  /** Hide the corner close button (the footer must then offer a way out). */
  hideClose?: boolean;
};

type FocusHandlers = Pick<ContentProps, "onOpenAutoFocus" | "onCloseAutoFocus">;

/** Remembers what had focus when the dialog opened and puts focus back there on close. */
function useReturnFocus({ onOpenAutoFocus, onCloseAutoFocus }: FocusHandlers): Required<FocusHandlers> {
  const returnTo = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event) => {
      // Fires before focus moves into the dialog, so activeElement is still the opener.
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      onOpenAutoFocus?.(event);
      if (event.defaultPrevented) return;
      // Start in the first form field, otherwise on the panel itself (screen readers then read the
      // title). Radix would pick the corner Close button, whose tooltip then swallows the first Escape.
      event.preventDefault();
      const panel = event.currentTarget as HTMLElement;
      const field = panel.querySelector<HTMLElement>(
        "[data-autofocus], input:not([disabled]):not([type=hidden]), textarea:not([disabled])",
      );
      (field ?? panel).focus();
    },
    onCloseAutoFocus: (event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      const target = returnTo.current;
      if (target?.isConnected && target !== document.body) {
        event.preventDefault();
        target.focus();
      }
    },
  };
}

const overlayClasses =
  "fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out";

function Header({ title, description, hideClose }: Pick<ContentProps, "title" | "description" | "hideClose">) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-2">
        <RadixDialog.Title className="text-title text-ink">{title}</RadixDialog.Title>
        {description ? (
          <RadixDialog.Description className="text-secondary text-ink-2">{description}</RadixDialog.Description>
        ) : null}
      </div>
      {!hideClose && (
        <RadixDialog.Close asChild>
          <IconButton icon={X} label="Close" className="-mr-2" />
        </RadixDialog.Close>
      )}
    </div>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">{children}</div>;
}

/** Centred dialog. */
export function DialogContent({
  title,
  description,
  footer,
  hideClose,
  children,
  className,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...rest
}: ContentProps) {
  const container = usePortalContainer();
  const focusHandlers = useReturnFocus({ onOpenAutoFocus, onCloseAutoFocus });
  return (
    <RadixDialog.Portal container={container}>
      {/* The overlay doubles as the scroll container so tall dialogs scroll on small screens. */}
      <RadixDialog.Overlay className={cn(overlayClasses, "grid place-items-center overflow-y-auto p-4")}>
        <RadixDialog.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cn(
            "flex w-full max-w-md flex-col gap-group rounded-card bg-elevated p-6 text-ink shadow-modal outline-none",
            "data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out",
            className,
          )}
          {...rest}
          {...focusHandlers}
        >
          <Header title={title} description={description} hideClose={hideClose} />
          {children}
          {footer && <Footer>{footer}</Footer>}
        </RadixDialog.Content>
      </RadixDialog.Overlay>
    </RadixDialog.Portal>
  );
}

/** Sheet: slides up from the bottom on mobile, in from the right from tablet width up. */
export function SheetContent({
  title,
  description,
  footer,
  hideClose,
  children,
  className,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...rest
}: ContentProps) {
  const container = usePortalContainer();
  const focusHandlers = useReturnFocus({ onOpenAutoFocus, onCloseAutoFocus });
  return (
    <RadixDialog.Portal container={container}>
      <RadixDialog.Overlay className={overlayClasses} />
      <RadixDialog.Content
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "fixed z-50 flex flex-col bg-elevated text-ink shadow-modal outline-none",
          "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-sheet",
          "data-[state=open]:animate-sheet-in-bottom data-[state=closed]:animate-sheet-out-bottom",
          // Side sheet: rounded on the two inner (left) corners, square against the screen edge.
          "md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-full md:max-w-lg md:rounded-tr-none md:rounded-bl-sheet",
          "md:data-[state=open]:animate-sheet-in-right md:data-[state=closed]:animate-sheet-out-right",
          className,
        )}
        {...rest}
        {...focusHandlers}
      >
        <div className="border-b border-line px-6 pt-4 pb-4">
          <Header title={title} description={description} hideClose={hideClose} />
        </div>
        {/* Padding inside the scroller keeps focus rings from being clipped (section 15). */}
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
        {footer && (
          <div className="border-t border-line px-6 py-4">
            <Footer>{footer}</Footer>
          </div>
        )}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
