import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface ToggleSwitchProps {
  id?: string;
  label: string;
  description?: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  labelPosition?: "left" | "right";
}

export function ToggleSwitch({
  id, label, description, checked, onCheckedChange,
  disabled, className, labelPosition = "right",
}: ToggleSwitchProps) {
  const switchId = id ?? `ts-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div
      className={cn(
        "flex items-center gap-3",
        labelPosition === "left" && "flex-row-reverse justify-between",
        className,
      )}
    >
      <Switch
        id={switchId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={description ? `${switchId}-desc` : undefined}
      />
      <div className="min-w-0">
        <Label
          htmlFor={switchId}
          className={cn(
            "cursor-pointer text-sm font-medium text-foreground leading-snug",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          {label}
        </Label>
        {description && (
          <p id={`${switchId}-desc`} className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}
