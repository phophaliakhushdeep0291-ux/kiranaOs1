import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface OwnerPinConfirmPayload {
  ownerPin: string;
  reason: string;
}

export interface OwnerPinModalProps {
  open: boolean;
  title: string;
  description?: string;
  reasonRequired?: boolean;
  onCancel: () => void;
  onConfirm: (payload: OwnerPinConfirmPayload) => void | Promise<void>;
  loading?: boolean;
  error?: string | null;
  confirmLabel?: string;
  reasonLabel?: string;
}

export function OwnerPinModal({
  open,
  title,
  description,
  reasonRequired = false,
  onCancel,
  onConfirm,
  loading = false,
  error,
  confirmLabel = "Confirm",
  reasonLabel = "Reason for audit trail",
}: OwnerPinModalProps) {
  const pinId = useId();
  const reasonId = useId();
  const pinRef = useRef<HTMLInputElement | null>(null);
  const [ownerPin, setOwnerPin] = useState("");
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setOwnerPin("");
      setReason("");
      setLocalError(null);
      return;
    }
    const timer = window.setTimeout(() => pinRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanPin = ownerPin.trim();
    const cleanReason = reason.trim();

    if (!/^\d{4}$/.test(cleanPin)) {
      setLocalError("Enter the 4-digit owner PIN.");
      return;
    }
    if (reasonRequired && cleanReason.length < 3) {
      setLocalError("Please enter a short reason for the audit trail.");
      return;
    }

    setLocalError(null);
    await onConfirm({ ownerPin: cleanPin, reason: cleanReason });
  }

  function cancel() {
    if (loading) return;
    onCancel();
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) cancel(); }}>
      <DialogContent className="max-w-sm" aria-describedby={description ? undefined : "owner-pin-default-description"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck size={18} aria-hidden="true" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <p id="owner-pin-default-description" className="text-sm text-muted-foreground">
            {description ?? "Owner PIN is required. This approval is saved in the local audit trail and backend must enforce it again during sync."}
          </p>

          <div className="space-y-1.5">
            <Label htmlFor={pinId}>Owner PIN *</Label>
            <Input
              id={pinId}
              ref={pinRef}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={ownerPin}
              onChange={(event) => setOwnerPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="Enter owner PIN"
              disabled={loading}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={reasonId}>{reasonLabel}{reasonRequired ? " *" : ""}</Label>
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={reasonRequired ? "Reason required for audit trail" : "Optional note for audit trail"}
              disabled={loading}
            />
          </div>

          {(localError || error) ? <p className="text-sm text-destructive" role="alert">{localError || error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={cancel} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Checking..." : confirmLabel}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
