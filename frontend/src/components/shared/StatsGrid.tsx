import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface StatsGridProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5;
}

const columnClasses: Record<NonNullable<StatsGridProps["columns"]>, string> = {
  2: "grid-cols-[repeat(2,minmax(0,1fr))]",
  3: "grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-[repeat(3,minmax(0,1fr))]",
  4: "grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(4,minmax(0,1fr))]",
  5: "grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-[repeat(3,minmax(0,1fr))] xl:grid-cols-[repeat(5,minmax(0,1fr))]",
};

export function StatsGrid({ children, columns = 4, className, ...props }: StatsGridProps) {
  return (
    <div
      className={cn(
        "grid w-full min-w-0 gap-3 sm:gap-4",
        columnClasses[columns],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
