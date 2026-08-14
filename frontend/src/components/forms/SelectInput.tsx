import { useAppLanguage } from "@/features/core/settings/i18n";
import { useId, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectInputProps {
  label?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  required?: boolean;
  id?: string;
  prefix?: ReactNode;
  wrapperClassName?: string;
  triggerClassName?: string;
}

export function SelectInput({
  label, hint, error, placeholder,
  value, onValueChange, options, disabled, required, id,
  prefix, wrapperClassName, triggerClassName,
}: SelectInputProps) {
  const { t } = useAppLanguage();
  const generatedId = useId();
  const inputId = id ?? `select-input-${generatedId.replace(/:/g, "")}`;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={cn("space-y-1.5", wrapperClassName)}>
      {label && (
        <Label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>}
        </Label>
      )}
      <div className="relative flex items-center">
        {prefix && (
          <span className="pointer-events-none absolute left-3 z-10 flex items-center text-muted-foreground">{prefix}</span>
        )}
        <Select value={value} onValueChange={onValueChange} disabled={disabled}>
          <SelectTrigger
            id={inputId}
            className={cn(
              "h-10",
              prefix && "pl-9",
              error && "border-destructive ring-destructive/30",
              triggerClassName,
            )}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            aria-required={required || undefined}
          >
            <SelectValue placeholder={placeholder ?? t("chrome.select")} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {hint && !error && (
        <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">{hint}</p>
      )}
      {error && (
        <p id={`${inputId}-error`} role="alert" aria-live="polite" className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
