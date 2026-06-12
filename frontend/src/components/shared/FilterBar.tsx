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
        "flex w-full flex-col gap-3 rounded-xl border bg-card/95 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
      {...props}
    >
      <div className="grid w-full min-w-0 gap-2 sm:flex sm:flex-1 sm:flex-wrap sm:items-center">{children}</div>
      {actions ? <div className="grid w-full grid-cols-1 gap-2 min-[420px]:flex min-[420px]:flex-wrap min-[420px]:items-center sm:w-auto sm:justify-end">{actions}</div> : null}
    </div>
  );
}
