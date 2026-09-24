import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api/http";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FurnitureOrder } from "@/types/api";

export function CollectionLinkDialog({ order, onClose, onSaved }: { order: FurnitureOrder; onClose: () => void; onSaved: () => void }) {
  const { t } = useAppLanguage();
  const [paymentId, setPaymentId] = useState("");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const candidates = useQuery({ queryKey: ["furniture-orders", order.id, "collections"], queryFn: () => apiRequest<{
    order: FurnitureOrder; payments: { id: string; amount: number; mode: string; businessDate: string; linked: boolean }[];
  }>(`/furniture-orders/${order.id}/collections`, { cache: "no-store" }) });
  const save = useMutation({ mutationFn: () => apiRequest(`/furniture-orders/${order.id}/collections/${paymentId}/link`, {
    method: "POST", ownerPin: pin, body: JSON.stringify({ reason, expectedPaidTotal: candidates.data?.order.paidTotal }),
  }), onSuccess: () => { setPin(""); onSaved(); } });
  return <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}><DialogContent className="max-w-md">
    <DialogHeader><DialogTitle>{t("furniture.collection.title")}</DialogTitle></DialogHeader>
    <p>{order.orderNumber} · {order.billNumber}</p>
    <p className="text-sm text-muted-foreground">{t("furniture.collection.help")}</p>
    <Label htmlFor="order-collection">{t("furniture.collection.receipt")}</Label>
    <select id="order-collection" className="h-11 rounded-md border bg-background px-3" value={paymentId} onChange={(event) => setPaymentId(event.target.value)} disabled={save.isPending || candidates.isPending}>
      <option value="">{t("furniture.collection.select")}</option>
      {candidates.data?.payments.filter((payment) => !payment.linked && payment.amount <= candidates.data.order.balanceDue).map((payment) =>
        <option key={payment.id} value={payment.id}>{new Date(payment.businessDate).toLocaleDateString()} · {payment.mode.toUpperCase()} · ₹{payment.amount}</option>)}
    </select>
    <Label htmlFor="order-collection-reason">{t("rental.refund.reason")}</Label>
    <Input id="order-collection-reason" className="h-11" disabled={save.isPending} value={reason} onChange={(event) => setReason(event.target.value)} />
    <Label htmlFor="order-collection-pin">{t("rental.refund.pin")}</Label>
    <Input id="order-collection-pin" className="h-11" type="password" inputMode="numeric" autoComplete="off" disabled={save.isPending} value={pin} onChange={(event) => setPin(event.target.value)} />
    {(save.error || candidates.error) && <p role="alert" className="text-sm text-destructive">{(save.error || candidates.error)?.message}</p>}
    {candidates.isError && <Button variant="outline" onClick={() => void candidates.refetch()}>{t("furniture.collection.retry")}</Button>}
    <Button className="h-11" disabled={save.isPending || !pin || reason.trim().length < 3 || !paymentId || candidates.isError}
      onClick={() => save.mutate()}>{t(save.isPending ? "rental.collection.saving" : "furniture.collection.confirm")}</Button>
  </DialogContent></Dialog>;
}
