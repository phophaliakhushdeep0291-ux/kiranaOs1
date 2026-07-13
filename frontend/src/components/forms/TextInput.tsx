import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  label?: string;
  hint?: string;
  error?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  wrapperClassName?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ label, hint, error, prefix, suffix, id, wrapperClassName, className, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? `text-input-${generatedId.replace(/:/g, "")}`;
    return (
      <div className={cn("space-y-1.5", wrapperClassName)}>
        {label && (
          <Label htmlFor={inputId} className="text-sm font-medium text-foreground">
            {label}
            {props.required && <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>}
          </Label>
        )}
        <div className="relative flex items-center">
          {prefix && (
            <span className="absolute left-3 flex items-center text-muted-foreground">{prefix}</span>
          )}
          <Input
            ref={ref}
            id={inputId}
            className={cn(
              "h-10",
              prefix && "pl-9",
              suffix && "pr-9",
              error && "border-destructive ring-destructive/30",
              className,
            )}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            aria-invalid={error ? true : undefined}
            {...props}
          />
          {suffix && (
            <span className="absolute right-3 flex items-center text-muted-foreground">{suffix}</span>
          )}
        </div>
        {hint && !error && (
          <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">{hint}</p>
        )}
        {error && (
          <p id={`${inputId}-error`} role="alert" aria-live="polite" className="text-xs text-destructive">{error}</p>
        )}
      </div>
    );
  },
);
TextInput.displayName = "TextInput";
