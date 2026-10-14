import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { Toast as RadixToast } from "radix-ui";
import { useSyncExternalStore, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { IconButton } from "./Button";
import { Icon } from "./Icon";

// Toasts (section 15): bottom-centre on mobile, bottom-right on desktop; auto-dismiss after 5 s and
// pause while hovered or focused; announced to screen readers (errors assertively).
// Never an Undo toast for destructive actions; those go through ConfirmDialog first (section 11.14).
export type ToastVariant = "success" | "info" | "warning" | "error";

export type ToastOptions = { variant?: ToastVariant; title: string; description?: string };
type ToastItem = Required<Pick<ToastOptions, "variant" | "title">> & { id: number; description?: string; open: boolean };

const AUTO_DISMISS_MS = 5000;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function setItems(next: ToastItem[]) {
  items = next;
  for (const listener of listeners) listener();
}

/** Show a toast from anywhere: toast({ variant: "success", title: "Task deleted." }). */
export function toast({ variant = "success", title, description }: ToastOptions) {
  setItems([...items, { id: nextId++, variant, title, description, open: true }]);
}

function dismiss(id: number) {
  setItems(items.map((item) => (item.id === id ? { ...item, open: false } : item)));
}

function remove(id: number) {
  setItems(items.filter((item) => item.id !== id));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const variantStyle: Record<ToastVariant, { icon: LucideIcon; iconClass: string; label: string }> = {
  success: { icon: CircleCheck, iconClass: "text-success-ink", label: "Success" },
  info: { icon: Info, iconClass: "text-info-ink", label: "Information" },
  warning: { icon: TriangleAlert, iconClass: "text-warning-ink", label: "Warning" },
  error: { icon: CircleAlert, iconClass: "text-danger-ink", label: "Error" },
};

const cardClasses =
  "flex w-full items-start gap-3 rounded-card border border-line bg-elevated py-2 pr-2 pl-4 text-ink shadow-floating";

/** The toast's visual body; also used for static previews. */
export function ToastBody({ variant, title, description, action }: Omit<ToastOptions, "variant"> & { variant: ToastVariant; action?: ReactNode }) {
  const style = variantStyle[variant];
  return (
    <>
      <Icon icon={style.icon} label={style.label} className={cn("mt-3", style.iconClass)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-2.5">
        <p className="text-secondary font-medium">{title}</p>
        {description && <p className="text-caption text-ink-2">{description}</p>}
      </div>
      {action}
    </>
  );
}

/** Static, non-dismissing toast for /dev/components. */
export function ToastPreview(props: Omit<ToastOptions, "variant"> & { variant: ToastVariant }) {
  return (
    <div className={cardClasses}>
      <ToastBody {...props} />
    </div>
  );
}

/** Mount once near the root of the app. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items);
  return (
    <RadixToast.Provider duration={AUTO_DISMISS_MS} swipeDirection="right" label="Notifications">
      {list.map((item) => (
        <RadixToast.Root
          key={item.id}
          open={item.open}
          onOpenChange={(open) => (open ? undefined : dismiss(item.id))}
          onAnimationEnd={() => (item.open ? undefined : remove(item.id))}
          type={item.variant === "error" ? "foreground" : "background"}
          className={cn(
            cardClasses,
            "data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out",
            "data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=end]:animate-toast-out",
          )}
        >
          <ToastBody
            variant={item.variant}
            title={item.title}
            description={item.description}
            action={
              <RadixToast.Close asChild>
                <IconButton icon={X} label="Dismiss" />
              </RadixToast.Close>
            }
          />
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport className="fixed inset-x-0 bottom-0 z-[100] mx-auto flex w-full max-w-sm flex-col gap-2 p-4 outline-none md:right-0 md:left-auto md:mx-0" />
    </RadixToast.Provider>
  );
}
