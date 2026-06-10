import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface FormSectionProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}

export function FormSection({ title, description, children, actions, compact = false, className, ...props }: FormSectionProps) {
  return (
    <div className={cn("space-y-4", className)} {...props}>
      <div className={cn("flex items-start justify-between gap-3", compact ? "mb-3" : "mb-4")}>
        <div>
          <h3 className={cn("font-bold text-foreground", compact ? "text-sm" : "text-base")}>{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className={cn("space-y-4", compact && "space-y-3")}>
        {children}
      </div>
    </div>
  );
}

export interface FormRowProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  cols?: 1 | 2 | 3 | 4;
}

export function FormRow({ children, cols = 2, className, ...props }: FormRowProps) {
  const gridCols = {
    1: "sm:grid-cols-1",
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-4",
  }[cols];
  return (
    <div className={cn("grid grid-cols-1 gap-4", gridCols, className)} {...props}>
      {children}
    </div>
  );
}
