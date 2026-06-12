import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface StatsGridProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5;
}

const columnClasses: Record<NonNullable<StatsGridProps["columns"]>, string> = {
  2: "min-[520px]:grid-cols-2",
  3: "min-[520px]:grid-cols-2 xl:grid-cols-3",
  4: "min-[520px]:grid-cols-2 xl:grid-cols-4",
  5: "min-[520px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
};

export function StatsGrid({ children, columns = 4, className, ...props }: StatsGridProps) {
  return (
    <div className={cn("grid w-full grid-cols-1 gap-3 sm:gap-4", columnClasses[columns], className)} {...props}>
      {children}
    </div>
  );
}
