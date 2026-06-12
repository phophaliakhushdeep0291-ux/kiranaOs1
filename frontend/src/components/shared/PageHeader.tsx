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
        <h1 className="text-balance font-display text-[1.55rem] font-black leading-tight tracking-tight text-foreground sm:text-3xl">{title}</h1>
        {description ? <div className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-[15px]">{description}</div> : null}
        {eyebrow ? <div className="text-xs text-muted-foreground">{eyebrow}</div> : null}
      </div>
      {actions ? <div className="grid w-full shrink-0 grid-cols-1 gap-2 min-[420px]:flex min-[420px]:flex-wrap min-[420px]:items-center sm:w-auto sm:justify-end">{actions}</div> : null}
    </header>
  );
}
