import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "prefix"> {
  label?: string;
  hint?: string;
  error?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  wrapperClassName?: string;
  allowDecimal?: boolean;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  ({ label, hint, error, prefix, suffix, id, wrapperClassName, className, allowDecimal = true, ...props }, ref) => {
    const inputId = id ?? (label ? `ni-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);
    return (
      <div className={cn("space-y-1.5", wrapperClassName)}>
        {label && (
          <Label htmlFor={inputId} className="text-sm font-medium text-foreground">
            {label}
            {props.required && <span className="ml-0.5 text-destructive">*</span>}
          </Label>
        )}
        <div className="relative flex items-center">
          {prefix && (
            <span className="absolute left-3 flex items-center text-sm text-muted-foreground">{prefix}</span>
          )}
          <Input
            ref={ref}
            id={inputId}
            type="number"
            inputMode={allowDecimal ? "decimal" : "numeric"}
            step={allowDecimal ? "any" : "1"}
            className={cn(
              "h-10 tabular-nums",
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
            <span className="absolute right-3 flex items-center text-sm text-muted-foreground">{suffix}</span>
          )}
        </div>
        {hint && !error && (
          <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">{hint}</p>
        )}
        {error && (
          <p id={`${inputId}-error`} role="alert" className="text-xs text-destructive">{error}</p>
        )}
      </div>
    );
  },
);
NumberInput.displayName = "NumberInput";
