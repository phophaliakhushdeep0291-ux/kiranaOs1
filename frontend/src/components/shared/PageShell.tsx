import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageShellProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  fullWidth?: boolean;
}

export function PageShell({ children, className, fullWidth = true, ...props }: PageShellProps) {
  return (
    <div
      className={cn(
        "app-page-shell",
        fullWidth ? "max-w-[1600px]" : "max-w-7xl",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
