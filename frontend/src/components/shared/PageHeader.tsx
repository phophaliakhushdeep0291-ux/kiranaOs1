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
        "mb-4 flex w-full min-w-0 flex-col gap-3 overflow-hidden sm:mb-5 md:flex-row md:items-start md:justify-between",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <h1 className="text-balance break-words font-display text-[clamp(1.35rem,1.1rem+0.9vw,1.9rem)] font-black leading-tight tracking-tight text-foreground">{title}</h1>
        {description ? <div className="max-w-3xl break-words text-sm leading-6 text-muted-foreground">{description}</div> : null}
        {eyebrow ? <div className="text-xs text-muted-foreground">{eyebrow}</div> : null}
      </div>
      {actions ? <div className="responsive-action-row min-w-0 max-w-full shrink-0 md:justify-end">{actions}</div> : null}
    </header>
  );
}
