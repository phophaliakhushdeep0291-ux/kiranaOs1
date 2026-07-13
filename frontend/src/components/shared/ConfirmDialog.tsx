import type { ReactNode } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = false, disabled = false, busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const controlsDisabled = disabled || busy;
  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary sm:mx-0">
            {busy
              ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
              : <AlertTriangle className={cn("h-5 w-5", destructive && "text-destructive")} aria-hidden="true" />}
          </div>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={controlsDisabled} onClick={(event) => { event.preventDefault(); onCancel(); }}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={controlsDisabled}
            onClick={(event) => { event.preventDefault(); onConfirm(); }}
            className={cn(destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
          >
            {busy ? "Please wait…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
