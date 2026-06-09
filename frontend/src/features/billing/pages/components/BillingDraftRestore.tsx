import { Badge } from "@/components/ui/badge";
import { PauseCircle, RotateCcw } from "lucide-react";
import type { HeldBill } from "../billing-types";

interface BillingDraftRestoreProps {
  draftRestored?: boolean;
  cartLength?: number;
  onHideDraftRestored?: () => void;
  heldBills?: HeldBill[];
  onResumeHeldBill?: (id: string) => void;
}

export function BillingDraftRestore({
  draftRestored = false,
  cartLength = 0,
  onHideDraftRestored,
  heldBills = [],
  onResumeHeldBill,
}: BillingDraftRestoreProps) {
  const showDraftRestored = draftRestored && cartLength > 0 && onHideDraftRestored;
  const showHeldBills = heldBills.length > 0 && onResumeHeldBill;

  if (!showDraftRestored && !showHeldBills) return null;

  return (
    <>
      {showDraftRestored && (
        <div className="shop-alert shop-alert-info flex items-center justify-between gap-2">
          <span><RotateCcw size={14} className="mr-1 inline" aria-hidden="true" /> Last unsaved bill restored automatically.</span>
          <button className="rounded-md px-2 py-1 text-xs font-semibold underline-offset-4 hover:underline" onClick={onHideDraftRestored}>Hide</button>
        </div>
      )}

      {showHeldBills && (
        <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold flex items-center gap-2"><PauseCircle size={15} /> Held bills</span>
            <Badge variant="secondary">{heldBills.length}</Badge>
          </div>
          {heldBills.slice(0, 3).map((held) => (
            <button key={held.id} onClick={() => onResumeHeldBill(held.id)} className="block w-full rounded-lg border bg-background px-3 py-2 text-left text-xs hover:bg-muted">
              <span className="font-medium">{held.label}</span>
              <span className="block text-muted-foreground">Tap to resume</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
