import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppLanguage } from "@/features/core/settings/i18n";
import type { FurnitureOrder } from "@/types/api";
import { getFurnitureOrder, reconcileFurnitureHistory } from "../api";

export function HistoryReconciliationDialog({ order, onClose, onSaved }: {
  order: FurnitureOrder; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useAppLanguage();
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [checked, setChecked] = useState(false);
  const detail = useQuery({ queryKey: ["furniture-history-review", order.id], queryFn: () => getFurnitureOrder(order.id), staleTime: 0, refetchOnWindowFocus: false });
  const receipts = detail.data?.unreconciledReceipts ?? [];
  const save = useMutation({
    mutationFn: () => reconcileFurnitureHistory(order.id, {
      reason, receipts: receipts.map((receipt) => ({ paymentId: receipt.id, amount: receipt.amount, mode: receipt.mode })),
    }, pin),
    onSuccess: () => { setPin(""); onSaved(); },
  });
  return <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
    <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
      <DialogHeader><DialogTitle>{t("furniture.history.title")}</DialogTitle></DialogHeader>
      <p>{order.orderNumber} · {order.customerName}</p>
      <p className="text-sm text-muted-foreground">{t("furniture.history.help")}</p>
      {detail.isPending && <p role="status">{t("furniture.history.loading")}</p>}
      {detail.error && <p role="alert" className="text-destructive">{detail.error.message}</p>}
      {detail.isSuccess && receipts.length === 0 && <p>{t("furniture.history.empty")}</p>}
      {receipts.length > 0 && <>
        <ul className="space-y-2">{receipts.map((receipt) => <li key={receipt.id} className="rounded border p-3 text-sm">
          <p>{new Date(receipt.paidOn).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })} · ₹{receipt.amount.toFixed(2)} · {receipt.mode.toUpperCase()}</p>
          {receipt.reference && <p>{receipt.reference}</p>}
        </li>)}</ul>
        {["delivered", "installed"].includes(order.status) && <p role="alert" className="text-sm">{t("furniture.history.delivered")}</p>}
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={checked} disabled={save.isPending} onChange={(event) => setChecked(event.target.checked)} />{t("furniture.history.checked")}</label>
        <Label htmlFor="history-reason">{t("rental.refund.reason")}</Label>
        <Input id="history-reason" maxLength={500} value={reason} disabled={save.isPending} onChange={(event) => setReason(event.target.value)} />
        <Label htmlFor="history-pin">{t("rental.refund.pin")}</Label>
        <Input id="history-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} disabled={save.isPending} onChange={(event) => setPin(event.target.value)} />
        {save.error && <p role="alert" className="text-destructive">{save.error.message}</p>}
        <Button className="min-h-11" disabled={save.isPending || !checked || !/^\d{4}$/.test(pin) || reason.trim().length < 3} onClick={() => save.mutate()}>{t(save.isPending ? "rental.collection.saving" : "furniture.history.confirm")}</Button>
      </>}
    </DialogContent>
  </Dialog>;
}
