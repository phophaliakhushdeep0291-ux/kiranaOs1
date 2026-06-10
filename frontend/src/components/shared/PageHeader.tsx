import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, description, eyebrow, actions, className, ...props }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "mb-4 flex w-full flex-col gap-3 sm:mb-5 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <h1 className="break-words font-display text-2xl font-black tracking-tight text-foreground sm:text-3xl">{title}</h1>
        {description ? <div className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</div> : null}
        {eyebrow ? <div className="text-xs text-muted-foreground">{eyebrow}</div> : null}
      </div>
      {actions ? <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{actions}</div> : null}
    </header>
  );
}
