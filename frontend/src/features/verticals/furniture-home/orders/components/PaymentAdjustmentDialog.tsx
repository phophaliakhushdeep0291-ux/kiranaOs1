import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { adjustFurniturePayment } from "../api";
import type { FurnitureOrder, FurnitureOrderPayment } from "@/types/api";

export function PaymentAdjustmentDialog({ order, payment, kind, onClose, onSaved }: {
  order: FurnitureOrder;
  payment: FurnitureOrderPayment;
  kind: "refund" | "correction";
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useAppLanguage();
  const available = payment.refundableAmount ?? 0;
  const [amount, setAmount] = useState(String(available));
  const [mode, setMode] = useState<string>(payment.mode);
  const [reference, setReference] = useState(payment.reference ?? "");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const save = useMutation({
    mutationFn: () => adjustFurniturePayment(order.id, payment.id, {
      clientRequestId: requestId, kind, amount: Number(amount), expectedPaidTotal: order.paidTotal,
      reason, ...(kind === "correction" ? { mode, reference } : {}),
    }, pin),
    onSuccess: () => { setPin(""); onSaved(); },
  });
  return <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>{t(kind === "refund" ? "furniture.refund.title" : "furniture.correction.title")}</DialogTitle></DialogHeader>
      <p>{order.orderNumber} · {order.customerName}</p>
      <p className="text-sm text-muted-foreground">{t(kind === "refund" ? "furniture.refund.help" : "furniture.correction.help")}</p>
      <Label htmlFor="order-adjust-amount">{t("furniture.payment.amount")}</Label>
      <Input id="order-adjust-amount" className="h-11" type="number" min="0.01" max={available} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={save.isPending || kind === "correction"} />
      {kind === "refund" ? <p>{t("furniture.payment.mode")}: {payment.mode.toUpperCase()}</p> : <>
        <Label htmlFor="order-adjust-mode">{t("furniture.payment.mode")}</Label>
        <select id="order-adjust-mode" className="h-11 rounded-md border bg-background px-3" value={mode} disabled={save.isPending} onChange={(event) => setMode(event.target.value)}>
          {["cash", "upi", "bank", "card", "other"].map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
        </select>
        <Label htmlFor="order-adjust-reference">{t("furniture.adjust.reference")}</Label>
        <Input id="order-adjust-reference" className="h-11" value={reference} disabled={save.isPending} onChange={(event) => setReference(event.target.value)} />
      </>}
      <Label htmlFor="order-adjust-reason">{t("rental.refund.reason")}</Label>
      <Input id="order-adjust-reason" className="h-11" value={reason} disabled={save.isPending} onChange={(event) => setReason(event.target.value)} />
      <Label htmlFor="order-adjust-pin">{t("rental.refund.pin")}</Label>
      <Input id="order-adjust-pin" className="h-11" type="password" inputMode="numeric" autoComplete="off" value={pin} disabled={save.isPending} onChange={(event) => setPin(event.target.value)} />
      {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
      <Button className="h-11" disabled={save.isPending || !pin || reason.trim().length < 3 || !(Number(amount) > 0) || Number(amount) > available}
        onClick={() => save.mutate()}>{t(save.isPending ? "rental.collection.saving" : kind === "refund" ? "rental.refund.confirm" : "furniture.correction.confirm")}</Button>
    </DialogContent>
  </Dialog>;
}
