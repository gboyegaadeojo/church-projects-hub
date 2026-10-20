import { CircleAlert } from "lucide-react";
import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Icon } from "./Icon";

// Form field wrapper (section 13, 15): associates the label, hint and error with its control.
// The error sits below the field, is announced, and should say how to fix it ("Enter a title for the task.").
type FieldContextValue = {
  controlId: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

/** Props a control spreads to link itself to the surrounding Field. */
export function useFieldControl(): {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
} {
  const field = useContext(FieldContext);
  if (!field) return {};
  return {
    id: field.controlId,
    "aria-describedby": field.describedBy,
    "aria-invalid": field.invalid || undefined,
    "aria-required": field.required || undefined,
  };
}

export function describedByIds(...ids: Array<string | false | undefined>): string | undefined {
  const joined = ids.filter(Boolean).join(" ");
  return joined || undefined;
}

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** A filter, or a control that always holds a value (a select): not marked "(optional)". */
  filter?: boolean;
  /** Label beside the control instead of above it (property panels). Never marked "(optional)". */
  inline?: boolean;
  className?: string;
  children: ReactNode;
};

export function Field({ label, hint, error, required = false, filter = false, inline = false, className, children }: FieldProps) {
  const controlId = useId();
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  return (
    <div className={cn(inline ? "grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1" : "flex flex-col gap-2", className)}>
      <label htmlFor={controlId} className={inline ? "text-secondary text-ink-2" : "text-secondary font-medium text-ink"}>
        {label}
        {!required && !filter && !inline && <span className="font-normal text-ink-2"> (optional)</span>}
      </label>
      {hint && (
        <p id={hintId} className="-mt-1 text-caption text-ink-2">
          {hint}
        </p>
      )}
      <FieldContext.Provider
        value={{ controlId, describedBy: describedByIds(hint && hintId, error && errorId), invalid: !!error, required }}
      >
        {children}
      </FieldContext.Provider>
      {inline ? (
        <div className="col-start-2">
          <FieldError id={errorId} error={error} />
        </div>
      ) : (
        <FieldError id={errorId} error={error} />
      )}
    </div>
  );
}

/** Error line shown below a control. Rendered as a live region so it is announced when it appears. */
export function FieldError({ id, error }: { id: string; error?: string }) {
  return (
    <p id={id} role="alert" className={cn("flex items-start gap-1 text-caption text-danger-ink", !error && "hidden")}>
      {error && (
        <>
          <Icon icon={CircleAlert} size="sm" className="mt-px" />
          <span>{error}</span>
        </>
      )}
    </p>
  );
}

/** Shared look for text-like controls. */
export const controlClasses =
  "w-full rounded-control border border-line-strong bg-card px-3 text-body text-ink placeholder:text-ink-2 " +
  "transition-colors duration-(--duration-micro) ease-out state-hover:border-ink-2 " +
  "disabled:cursor-not-allowed disabled:border-line disabled:bg-disabled disabled:text-ink-disabled " +
  "aria-invalid:border-danger-ink aria-invalid:ring-1 aria-invalid:ring-inset aria-invalid:ring-danger-ink";
