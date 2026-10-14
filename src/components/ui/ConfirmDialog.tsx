import { CircleAlert, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { Dialog, DialogContent } from "./Dialog";
import { Field } from "./Field";
import { Icon } from "./Icon";
import { TextInput } from "./inputs";
import { toast } from "./Toast";

// Confirmation dialog for every destructive action (section 11.14).
// - Title names the action and item ("Delete MEDIA-42?"); one sentence on the consequence.
// - Cancel has initial focus; the destructive button is labelled with its verb ("Delete task"), never OK/Yes.
// - High-impact actions pass confirmText: the button stays disabled until it is typed
//   (letter case and leading/trailing spaces are ignored).
// - Escape and clicking outside cancel. On success a toast confirms the result ("Task deleted.").
// The caller writes the audit event as part of the action itself (server side).

const VAGUE_LABELS = /^(ok|okay|yes|confirm|continue|sure)$/i;

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the action and the item, e.g. "Delete MEDIA-42?" */
  title: string;
  /** One sentence on the consequence, e.g. "This removes the task and its comments for everyone." */
  description: string;
  /** The verb, e.g. "Delete task", "Suspend user". */
  confirmLabel: string;
  confirmIcon?: LucideIcon;
  /** Runs the action. If it returns a promise the button shows a spinner until it settles. */
  onConfirm: () => void | Promise<void>;
  /** For high-impact actions: the project key or email the person must type. */
  confirmText?: string;
  /** Toast shown after the action succeeds, e.g. "Task deleted." */
  successMessage?: string;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmIcon,
  onConfirm,
  confirmText,
  successMessage,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (open) {
      setTyped("");
      setFailed(false);
    }
  }, [open]);

  if (VAGUE_LABELS.test(confirmLabel.trim())) {
    throw new Error(`ConfirmDialog: "${confirmLabel}" is not allowed. Label the button with its verb, e.g. "Delete task".`);
  }

  // Case-insensitive and ignores surrounding spaces, for project keys and email addresses alike.
  const matches = confirmText === undefined || typed.trim().toLowerCase() === confirmText.trim().toLowerCase();

  function handleOpenChange(next: boolean) {
    // Keep the dialog up while the action is in flight so its result is never hidden.
    if (pending) return;
    onOpenChange(next);
  }

  async function handleConfirm() {
    if (!matches || pending) return;
    setFailed(false);
    setPending(true);
    try {
      await onConfirm();
      setPending(false);
      onOpenChange(false);
      if (successMessage) toast({ variant: "success", title: successMessage });
    } catch {
      setPending(false);
      setFailed(true);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        role="alertdialog"
        title={title}
        description={description}
        hideClose
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        footer={
          <>
            <Button ref={cancelRef} variant="secondary" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              icon={confirmIcon}
              disabled={!matches}
              loading={pending}
              onClick={handleConfirm}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        {confirmText !== undefined && (
          <Field label={`Type ${confirmText} to confirm.`} required>
            <TextInput
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleConfirm();
                }
              }}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </Field>
        )}
        {failed && (
          <p role="alert" className="flex items-start gap-2 rounded-control bg-danger-soft p-3 text-secondary text-danger-ink">
            <Icon icon={CircleAlert} className="mt-px" />
            <span>That didn't go through. Check your connection and try again.</span>
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
