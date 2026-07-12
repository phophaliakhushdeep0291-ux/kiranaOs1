import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cancelSubscription } from "@/features/subscription/api";
import { writeSubscriptionSnapshot } from "@/features/subscription/access";
import { ApiClientError } from "@/lib/api/http";
import { useToast } from "@/hooks/use-toast";

function cancelErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) return error.message;
  return error instanceof Error ? error.message : "Could not cancel the subscription.";
}

export function CancelSubscriptionDialog({
  open,
  onOpenChange,
  planName,
  periodEndLabel,
  onCancelled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planName: string;
  periodEndLabel?: string | null;
  onCancelled?: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [ownerPin, setOwnerPin] = useState("");
  const [saving, setSaving] = useState(false);

  function close(next: boolean) {
    if (!next) setOwnerPin("");
    onOpenChange(next);
  }

  async function confirmCancel() {
    if (!/^\d{4}$/.test(ownerPin)) {
      toast({ title: "Owner PIN required", description: "Enter the 4-digit owner PIN to cancel.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const subscription = await cancelSubscription(ownerPin);
      await writeSubscriptionSnapshot(subscription as unknown as Record<string, unknown>);
      toast({
        title: "Subscription cancelled",
        description: "Your data stays viewable. You can resubscribe anytime.",
      });
      setOwnerPin("");
      onOpenChange(false);
      await onCancelled?.();
    } catch (error) {
      toast({ title: "Could not cancel", description: cancelErrorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel {planName} subscription?</DialogTitle>
          <DialogDescription>
            This plan is currently active. Cancelling stops future renewals.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div className="space-y-1">
            <p>Your existing data stays safe and viewable.</p>
            <p>
              {periodEndLabel
                ? `Paid access continues until ${periodEndLabel}, then cloud sync and premium actions pause until you resubscribe.`
                : "After the current period, cloud sync and premium actions pause until you resubscribe."}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cancel-owner-pin">Owner PIN</Label>
          <Input
            id="cancel-owner-pin"
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={ownerPin}
            placeholder="4-digit PIN"
            onChange={(e) => setOwnerPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={saving}>
            Keep subscription
          </Button>
          <Button variant="destructive" onClick={() => void confirmCancel()} disabled={saving}>
            {saving ? "Cancelling..." : "Cancel subscription"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
