import { useId, type HTMLAttributes, type ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action, className, ...props }: EmptyStateProps) {
  const id = useId();
  const titleId = `empty-title-${id.replace(/:/g, "")}`;
  const descriptionId = `empty-description-${id.replace(/:/g, "")}`;

  return (
    <div
      className={cn("flex min-h-28 w-full flex-col items-center justify-center rounded-lg border border-dashed bg-muted/15 p-5 text-center", className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      {...props}
    >
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-background text-muted-foreground shadow-xs">
        {icon ?? <Inbox className="h-5 w-5" aria-hidden="true" />}
      </div>
      <p id={titleId} className="font-medium text-foreground">{title}</p>
      {description ? <p id={descriptionId} className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
