import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type RightDrawerSize = "sm" | "md" | "lg" | "xl" | "full";

const sizeClass: Record<RightDrawerSize, string> = {
  sm:   "max-w-sm",
  md:   "max-w-md",
  lg:   "max-w-lg",
  xl:   "max-w-xl",
  full: "max-w-full",
};

export interface RightDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: RightDrawerSize;
  className?: string;
}

export function RightDrawer({
  open, onOpenChange, title, description, children, footer,
  size = "md", className,
}: RightDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "flex w-full flex-col gap-0 p-0",
          sizeClass[size],
          className,
        )}
      >
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="font-display text-lg font-black">{title}</SheetTitle>
          {description ? (
            <SheetDescription className="text-sm text-muted-foreground">{description}</SheetDescription>
          ) : null}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {footer ? (
          <div className="border-t px-5 py-4">
            {footer}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
