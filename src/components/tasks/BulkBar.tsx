import { CalendarDays, ChevronDown, Columns3, Tag, UserRound, X } from "lucide-react";
import { useState } from "react";
import type { BulkEditBody, Label, Member, WorkflowState } from "../../../shared/tasks";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { DateInput } from "../ui/inputs";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../ui/Menu";

// Bulk edit (TASK-10): change assignee, status, labels or due date for the selected tasks.

export function BulkBar({
  count,
  states,
  assignable,
  labels,
  pending,
  onApply,
  onClear,
}: {
  count: number;
  states: WorkflowState[];
  assignable: Member[];
  labels: Label[];
  pending: boolean;
  onApply: (changes: Omit<BulkEditBody, "taskIds">) => void;
  onClear: () => void;
}) {
  const [due, setDue] = useState("");
  return (
    <div
      role="region"
      aria-label="Bulk edit"
      className="sticky bottom-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom)+8px)] z-30 flex flex-wrap items-center gap-2 rounded-card border border-line bg-elevated p-2 shadow-floating md:bottom-4"
    >
      <p className="px-2 text-secondary font-medium text-ink tabular-nums" aria-live="polite">
        {count === 1 ? "1 task selected" : `${count} tasks selected`}
      </p>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="secondary" icon={UserRound} disabled={pending}>
            Assign <ChevronDown aria-hidden className="size-icon-sm" />
          </Button>
        </MenuTrigger>
        <MenuContent align="start">
          <MenuLabel>Assign to</MenuLabel>
          {assignable.map((m) => (
            <MenuItem key={m.id} onSelect={() => onApply({ assigneeId: m.id })}>
              {m.name}
            </MenuItem>
          ))}
          <MenuItem onSelect={() => onApply({ assigneeId: null })}>Unassigned</MenuItem>
        </MenuContent>
      </Menu>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="secondary" icon={Columns3} disabled={pending}>
            Status <ChevronDown aria-hidden className="size-icon-sm" />
          </Button>
        </MenuTrigger>
        <MenuContent align="start">
          <MenuLabel>Move to</MenuLabel>
          {states.map((s) => (
            <MenuItem key={s.id} onSelect={() => onApply({ stateId: s.id })}>
              {s.name}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      {labels.length > 0 && (
        <Menu>
          <MenuTrigger asChild>
            <Button variant="secondary" icon={Tag} disabled={pending}>
              Labels <ChevronDown aria-hidden className="size-icon-sm" />
            </Button>
          </MenuTrigger>
          <MenuContent align="start">
            <MenuLabel>Add label</MenuLabel>
            {labels.map((l) => (
              <MenuItem key={`add-${l.id}`} onSelect={() => onApply({ addLabelIds: [l.id] })}>
                {l.name}
              </MenuItem>
            ))}
            <MenuLabel>Remove label</MenuLabel>
            {labels.map((l) => (
              <MenuItem key={`remove-${l.id}`} onSelect={() => onApply({ removeLabelIds: [l.id] })}>
                {l.name}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary" icon={CalendarDays} disabled={pending}>
            Due date
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" aria-label="Set due date" className="flex flex-col gap-3">
          <Field label="Due date" required>
            <DateInput value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <PopoverClose asChild>
              <Button disabled={!due} onClick={() => onApply({ dueDate: due })}>
                Set date
              </Button>
            </PopoverClose>
            <PopoverClose asChild>
              <Button variant="secondary" onClick={() => onApply({ dueDate: null })}>
                Remove date
              </Button>
            </PopoverClose>
          </div>
        </PopoverContent>
      </Popover>
      <Button variant="ghost" icon={X} onClick={onClear} className="ml-auto">
        Clear selection
      </Button>
    </div>
  );
}
