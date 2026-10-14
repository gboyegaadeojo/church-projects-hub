import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { controlClasses, describedByIds, useFieldControl } from "./Field";

// Text-like controls. Place inside <Field> so they get their label, hint and error wiring.

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, type = "text", "aria-describedby": describedBy, ...rest },
  ref,
) {
  const field = useFieldControl();
  return (
    <input
      ref={ref}
      type={type}
      {...field}
      aria-describedby={describedByIds(field["aria-describedby"], describedBy)}
      className={cn(controlClasses, "min-h-touch", className)}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 4, "aria-describedby": describedBy, ...rest },
  ref,
) {
  const field = useFieldControl();
  return (
    <textarea
      ref={ref}
      rows={rows}
      {...field}
      aria-describedby={describedByIds(field["aria-describedby"], describedBy)}
      className={cn(controlClasses, "resize-y py-2", className)}
      {...rest}
    />
  );
});

/**
 * Date picker: the browser's native date input. It is keyboard and screen-reader accessible,
 * opens the platform picker on phones, and follows the theme through color-scheme.
 * Value is an ISO date string (YYYY-MM-DD).
 */
export const DateInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(
  function DateInput(props, ref) {
    return <TextInput ref={ref} type="date" className="tabular-nums" {...props} />;
  },
);
