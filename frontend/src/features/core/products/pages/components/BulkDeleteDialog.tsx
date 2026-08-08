import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  runBulkProductDelete,
  summariseBulkDelete,
  type BulkDeleteFailure,
  type SelectedProduct,
} from "@/features/core/products/bulk-delete";

interface BulkDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: SelectedProduct[];
  onDone: () => void;
}

interface RunState {
  done: number;
  total: number;
}

function rupees(value: number) {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function BulkDeleteDialog({ open, onOpenChange, products, onDone }: BulkDeleteDialogProps) {
  const { toast } = useToast();
  const [ownerPin, setOwnerPin] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [failures, setFailures] = useState<BulkDeleteFailure[]>([]);
  const abort = useRef<AbortController | null>(null);

  const summary = useMemo(() => summariseBulkDelete(products), [products]);
  const busy = run !== null;

  function reset() {
    setOwnerPin("");
    setReason("");
    setError(null);
    setFailures([]);
  }

  async function confirm() {
    // The real gate is deleteProductLocalFirst, which re-validates the PIN per product.
    // These two checks only save the shopkeeper from typing the reason 200 times before
    // being told it was too short.
    if (ownerPin.trim().length < 4) {
      setError("Owner PIN is required to delete products.");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Please enter a short reason for the audit trail.");
      return;
    }

    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setFailures([]);
    setRun({ done: 0, total: products.length });

    try {
      const result = await runBulkProductDelete(products, {
        ownerPin: ownerPin.trim(),
        reason: reason.trim(),
        signal: controller.signal,
        onProgress: ({ done, total }) => setRun({ done, total }),
      });

      setFailures(result.failures);
      const failed = result.failures.length;
      toast({
        title: result.cancelled
          ? `Stopped after ${result.deleted} product${result.deleted === 1 ? "" : "s"}`
          : `Moved ${result.deleted} product${result.deleted === 1 ? "" : "s"} to the recycle bin`,
        description: failed > 0
          ? `${failed} could not be deleted — the rest are in the recycle bin and can be restored.`
          : "They can be restored from the recycle bin.",
        variant: failed > 0 ? "destructive" : "default",
      });

      onDone();
      // Leave the dialog open when something failed, so the named rows can be read.
      if (failed === 0) {
        onOpenChange(false);
        reset();
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The delete could not be completed.");
    } finally {
      abort.current = null;
      setRun(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return; // a run in flight owns the dialog; Cancel stops it first
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 size={18} aria-hidden="true" />
            Delete {summary.total} product{summary.total === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>
            This is a soft delete. Every product moves to the recycle bin and can be restored — bills,
            stock history and past reports are not touched.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border p-3" data-testid="bulk-delete-summary">
            <p className="text-xs font-bold uppercase text-muted-foreground">What you are deleting</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {summary.categories.map((category) => (
                <span key={category.name} className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold capitalize">
                  {category.name.replace(/[_-]/g, " ")} · {category.count}
                </span>
              ))}
            </div>
          </div>

          {summary.withStock > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="bulk-delete-stock-warning">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
              <p className="text-[12px] leading-5 text-amber-900">
                <span className="font-bold">{summary.withStock}</span> of these still hold stock, worth about{" "}
                <span className="font-bold">{rupees(summary.stockValue)}</span> at cost. Deleting them does not write the
                stock off — it hides items you still have on the shelf.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="bulk-delete-pin">Owner PIN *</Label>
            <Input
              id="bulk-delete-pin"
              data-testid="bulk-delete-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Enter owner PIN"
              value={ownerPin}
              disabled={busy}
              onChange={(event) => setOwnerPin(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-delete-reason">Reason for audit trail *</Label>
            <Textarea
              id="bulk-delete-reason"
              data-testid="bulk-delete-reason"
              placeholder="For example: starter catalog items this shop does not sell"
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

          {busy && (
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between text-[12px] font-bold text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  Deleting {run.done} of {run.total}...
                </span>
                <span>{run.total > 0 ? Math.round((run.done / run.total) * 100) : 0}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-destructive transition-all"
                  style={{ width: `${run.total > 0 ? Math.round((run.done / run.total) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}

          {failures.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3" data-testid="bulk-delete-failures">
              <p className="text-[12px] font-bold text-destructive">
                {failures.length} could not be deleted and are unchanged:
              </p>
              <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto text-[11px] text-muted-foreground">
                {failures.map((failure) => (
                  <li key={failure.id}><span className="font-semibold">{failure.name}</span> — {failure.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-2 flex justify-end gap-2">
          {busy ? (
            <Button variant="outline" data-testid="bulk-delete-cancel" onClick={() => abort.current?.abort()}>
              Cancel — keep the rest
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button
                variant="destructive"
                data-testid="bulk-delete-confirm"
                disabled={summary.total === 0}
                onClick={() => void confirm()}
              >
                Move {summary.total} to recycle bin
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
