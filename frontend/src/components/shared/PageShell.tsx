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
        "mx-auto w-full px-3.5 py-4 sm:px-5 sm:py-5 lg:px-6",
        fullWidth ? "max-w-[1500px]" : "max-w-7xl",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
