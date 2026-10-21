import { OctagonAlert } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useRef, useState } from "react";
import { blockedReason, TASK_LIMITS } from "../../../shared/tasks";
import { Button } from "../ui/Button";
import { Dialog, DialogContent } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Textarea } from "../ui/inputs";

// v4.7: moving a task into a blocking column asks why, every time — drag and drop, the Move menu, the status field and
// bulk edit all go through this. Cancel leaves the task where it was. The API enforces it too.

type Ask = { title: string; column: string; initial?: string; resolve: (reason: string | null) => void };

/** `ask(...)` opens the dialog and resolves with the reason, or null if cancelled. Render `dialog` once. */
export function useBlockReason(): { ask: (what: string, column: string, initial?: string) => Promise<string | null>; dialog: ReactNode } {
  const [pending, setPending] = useState<Ask | null>(null);
  const ask = useCallback(
    (title: string, column: string, initial?: string) => new Promise<string | null>((resolve) => setPending({ title, column, initial, resolve })),
    [],
  );
  const close = (reason: string | null) => {
    pending?.resolve(reason);
    setPending(null);
  };
  return { ask, dialog: pending && <ReasonDialog key={pending.title + pending.column} ask={pending} onClose={close} /> };
}

function ReasonDialog({ ask, onClose }: { ask: Ask; onClose: (reason: string | null) => void }) {
  const [text, setText] = useState(ask.initial ?? "");
  const [error, setError] = useState<string>();
  const done = useRef(false);
  const finish = (reason: string | null) => {
    if (done.current) return;
    done.current = true;
    onClose(reason);
  };
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = blockedReason.safeParse(text);
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    finish(parsed.data);
  }
  return (
    <Dialog open onOpenChange={(open) => !open && finish(null)}>
      <DialogContent
        title={`Why is ${ask.title} blocked?`}
        description={`Moving it to ${ask.column} tells everyone on it. Say what it's waiting for.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" form="block-reason" icon={OctagonAlert}>
              Mark as blocked
            </Button>
          </>
        }
      >
        <form id="block-reason" onSubmit={submit} noValidate>
          <Field label="Reason" required error={error}>
            <Textarea rows={3} value={text} maxLength={TASK_LIMITS.blockedReason} placeholder="Waiting for the new DI box to arrive" onChange={(e) => setText(e.target.value)} />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
