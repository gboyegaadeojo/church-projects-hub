import { Check, ChevronDown } from "lucide-react";
import { Checkbox as RadixCheckbox, RadioGroup as RadixRadioGroup, Select as RadixSelect, Switch as RadixSwitch } from "radix-ui";
import { useId, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { controlClasses, describedByIds, FieldError, useFieldControl } from "./Field";
import { Icon } from "./Icon";
import { usePortalContainer } from "./portal";

// Choice controls (section 15): select, checkbox, radio group and toggle.
// Small visual boxes get an invisible hit area so the touch target is 44 × 44 px (section 12).
const hitArea = "relative after:absolute after:-inset-3 after:content-['']";

/* ---------- Select (inside <Field>) ---------- */

export type SelectOption = { value: string; label: string; disabled?: boolean };

type SelectProps = {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
};

export function Select({ options, placeholder = "Choose…", ...rest }: SelectProps) {
  const field = useFieldControl();
  const container = usePortalContainer();
  return (
    <RadixSelect.Root {...rest}>
      <RadixSelect.Trigger
        {...field}
        className={cn(
          controlClasses,
          "inline-flex min-h-touch items-center justify-between gap-2 text-left data-placeholder:text-ink-2",
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="text-ink-2">
          <Icon icon={ChevronDown} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal container={container}>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-control border border-line bg-elevated text-ink shadow-floating data-[state=open]:animate-pop-in"
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex min-h-touch cursor-default select-none items-center rounded-chip py-2 pr-3 pl-9 text-body outline-none data-disabled:text-ink-disabled data-highlighted:bg-hover"
              >
                <RadixSelect.ItemIndicator className="absolute left-2 inline-flex text-accent-ink">
                  <Icon icon={Check} />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

/* ---------- Checkbox and Switch (own inline label) ---------- */

type InlineChoiceProps = {
  label: string;
  hint?: string;
  error?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  "data-preview"?: string;
};

function InlineChoice({
  label,
  hint,
  error,
  disabled,
  control,
}: Pick<InlineChoiceProps, "label" | "hint" | "error" | "disabled"> & {
  control: (ids: { id: string; describedBy?: string }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-touch items-center gap-3">
        {control({ id, describedBy: describedByIds(hint && hintId, error && errorId) })}
        <label htmlFor={id} className={cn("text-body", disabled ? "text-ink-disabled" : "text-ink")}>
          {label}
        </label>
      </div>
      {hint && (
        <p id={hintId} className="text-caption text-ink-2">
          {hint}
        </p>
      )}
      <FieldError id={errorId} error={error} />
    </div>
  );
}

export function Checkbox({ label, hint, error, disabled, ...rest }: InlineChoiceProps) {
  return (
    <InlineChoice
      label={label}
      hint={hint}
      error={error}
      disabled={disabled}
      control={({ id, describedBy }) => (
        <RadixCheckbox.Root
          id={id}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={!!error || undefined}
          className={cn(
            hitArea,
            "inline-flex size-5 shrink-0 items-center justify-center rounded-chip border border-line-strong bg-card text-on-accent",
            "transition-colors duration-(--duration-micro) ease-out state-hover:border-ink-2",
            "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
            "disabled:cursor-not-allowed disabled:border-line disabled:bg-disabled data-[state=checked]:disabled:text-ink-disabled",
            "aria-invalid:border-danger-ink",
          )}
          {...rest}
        >
          <RadixCheckbox.Indicator>
            <Icon icon={Check} size="sm" />
          </RadixCheckbox.Indicator>
        </RadixCheckbox.Root>
      )}
    />
  );
}

/** Toggle for settings that take effect immediately. */
export function Switch({ label, hint, error, disabled, ...rest }: InlineChoiceProps) {
  return (
    <InlineChoice
      label={label}
      hint={hint}
      error={error}
      disabled={disabled}
      control={({ id, describedBy }) => (
        <RadixSwitch.Root
          id={id}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={!!error || undefined}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-line-strong bg-hover p-px",
            "after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-['']",
            "transition-colors duration-(--duration-micro) ease-out",
            "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
            "disabled:cursor-not-allowed disabled:border-line disabled:bg-disabled",
            "aria-invalid:border-danger-ink",
          )}
          {...rest}
        >
          <RadixSwitch.Thumb
            className={cn(
              "block size-5 rounded-full bg-card shadow-raised transition-transform duration-(--duration-micro) ease-spring",
              "data-[state=checked]:translate-x-5",
            )}
          />
        </RadixSwitch.Root>
      )}
    />
  );
}

/* ---------- Radio group ---------- */

type RadioGroupProps = {
  legend: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  hint?: string;
  error?: string;
  disabled?: boolean;
  name?: string;
};

export function RadioGroup({ legend, options, hint, error, disabled, ...rest }: RadioGroupProps) {
  const id = useId();
  const legendId = `${id}-legend`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <fieldset className="flex flex-col gap-1">
      <legend id={legendId} className="text-secondary font-medium text-ink">
        {legend}
      </legend>
      {hint && (
        <p id={hintId} className="text-caption text-ink-2">
          {hint}
        </p>
      )}
      <RadixRadioGroup.Root
        aria-labelledby={legendId}
        aria-describedby={describedByIds(hint && hintId, error && errorId)}
        aria-invalid={!!error || undefined}
        disabled={disabled}
        className="flex flex-col"
        {...rest}
      >
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;
          const optionDisabled = disabled || option.disabled;
          return (
            <div key={option.value} className="flex min-h-touch items-center gap-3">
              <RadixRadioGroup.Item
                id={optionId}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  hitArea,
                  "inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-line-strong bg-card",
                  "transition-colors duration-(--duration-micro) ease-out state-hover:border-ink-2",
                  "data-[state=checked]:border-accent",
                  "disabled:cursor-not-allowed disabled:border-line disabled:bg-disabled",
                  error && "border-danger-ink",
                )}
              >
                <RadixRadioGroup.Indicator className="block size-2.5 rounded-full bg-accent" />
              </RadixRadioGroup.Item>
              <label htmlFor={optionId} className={cn("text-body", optionDisabled ? "text-ink-disabled" : "text-ink")}>
                {option.label}
              </label>
            </div>
          );
        })}
      </RadixRadioGroup.Root>
      <FieldError id={errorId} error={error} />
    </fieldset>
  );
}
