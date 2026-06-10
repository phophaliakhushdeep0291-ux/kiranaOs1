import { forwardRef, type InputHTMLAttributes } from "react";
import { CalendarIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface DatePickerInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
}

export const DatePickerInput = forwardRef<HTMLInputElement, DatePickerInputProps>(
  ({ label, hint, error, id, wrapperClassName, className, ...props }, ref) => {
    const inputId = id ?? (label ? `dp-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);
    return (
      <div className={cn("space-y-1.5", wrapperClassName)}>
        {label && (
          <Label htmlFor={inputId} className="text-sm font-medium text-foreground">
            {label}
            {props.required && <span className="ml-0.5 text-destructive">*</span>}
          </Label>
        )}
        <div className="relative flex items-center">
          <CalendarIcon
            size={16}
            className="pointer-events-none absolute left-3 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={ref}
            id={inputId}
            type="date"
            className={cn(
              "h-10 pl-9",
              error && "border-destructive ring-destructive/30",
              className,
            )}
            aria-invalid={error ? true : undefined}
            {...props}
          />
        </div>
        {hint && !error && (
          <p className="text-xs text-muted-foreground">{hint}</p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">{error}</p>
        )}
      </div>
    );
  },
);
DatePickerInput.displayName = "DatePickerInput";
