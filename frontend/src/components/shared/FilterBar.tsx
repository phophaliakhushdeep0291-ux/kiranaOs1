import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface FilterBarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  actions?: ReactNode;
}

export function FilterBar({ children, actions, className, ...props }: FilterBarProps) {
  return (
    <div
      className={cn(
        "premium-panel-muted flex w-full min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
      {...props}
    >
      <div className="grid w-full min-w-0 gap-2 sm:flex sm:flex-1 sm:flex-wrap sm:items-center">{children}</div>
      {actions ? <div className="responsive-action-row shrink-0 sm:justify-end">{actions}</div> : null}
    </div>
  );
}
