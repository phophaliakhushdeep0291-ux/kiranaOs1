import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createFurnitureInvoice, previewFurnitureInvoice, type FurnitureInvoiceInput, type FurnitureInvoicePreview } from "../api";
import type { FurnitureOrder } from "@/types/api";

export function InvoiceDeliveryDialog({ order, onClose, onSaved }: { order: FurnitureOrder; onClose: () => void; onSaved: () => void }) {
  const { t } = useAppLanguage();
  const [busy, setBusy] = useState(false);
  const preview = useQuery({ queryKey: ["furniture-orders", order.id, "invoice-preview"], queryFn: () => previewFurnitureInvoice(order.id),
    staleTime: 0, refetchOnWindowFocus: false, retry: false });
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>{t(["delivered", "installed"].includes(order.status) ? "furniture.history.repairInvoice" : "furniture.invoice.title")}</DialogTitle></DialogHeader>
      {preview.isPending && <p role="status">{t("furniture.invoice.loading")}</p>}
      {preview.error && <p role="alert" className="text-destructive">{preview.error.message}</p>}
      {preview.data && <InvoiceReview key={preview.data.previewToken} preview={preview.data} onBusy={setBusy} onSaved={onSaved} />}
      <div className="flex gap-2">
        <Button variant="outline" disabled={busy || preview.isFetching} onClick={() => void preview.refetch()}>{t("furniture.invoice.reload")}</Button>
        <Button variant="outline" disabled={busy} onClick={onClose}>{t("furniture.delivery.back")}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

function InvoiceReview({ preview, onBusy, onSaved }: { preview: FurnitureInvoicePreview; onBusy: (busy: boolean) => void; onSaved: () => void }) {
  const { t } = useAppLanguage();
  const [legacyStockConfirmed, setLegacyStockConfirmed] = useState(false);
  const [businessDate, setBusinessDate] = useState(preview.order.deliveredAtKey ?? "");
  const [taxMode, setTaxMode] = useState<FurnitureInvoiceInput["taxMode"] | "">("");
  const [taxes, setTaxes] = useState(() => preview.lines.map(({ lineId, gstRate, hsn }) => ({ lineId, gstRate, hsn: hsn ?? "" })));
  const [customerId, setCustomerId] = useState(preview.order.customerId ?? "");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const save = useMutation({ mutationFn: async () => {
    if (!taxMode) throw new Error(t("furniture.invoice.chooseTax"));
    return createFurnitureInvoice(preview.order.id, {
      ...(preview.legacyDelivery ? { legacyStockConfirmed, businessDate } : {}),
      previewToken: preview.previewToken, taxMode, customerId: customerId || undefined, reason,
      taxes: taxes.map((tax) => ({ ...tax, hsn: tax.hsn.trim() || undefined })),
    }, pin);
  }, onMutate: () => onBusy(true), onSettled: () => onBusy(false), onSuccess: () => { setPin(""); onSaved(); } });
  const needsCustomer = preview.order.balanceDue > 0 && !customerId;
  return <>
    <p className="font-semibold">{preview.order.orderNumber} · {preview.order.customerName}</p>
    <p className="text-sm text-muted-foreground">{t("furniture.invoice.help")}</p>
    {preview.legacyDelivery && <div className="space-y-3 rounded-lg border border-amber-300 p-3">
      <p className="text-sm">{t("furniture.history.invoiceHelp")}</p>
      <Label htmlFor="legacy-sale-date">{t("furniture.history.saleDate")}</Label>
      <Input id="legacy-sale-date" type="date" value={businessDate} disabled={save.isPending} onChange={(event) => setBusinessDate(event.target.value)} />
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={legacyStockConfirmed} disabled={save.isPending} onChange={(event) => setLegacyStockConfirmed(event.target.checked)} />{t("furniture.history.stockConfirmation")}</label>
    </div>}
    <dl className="grid grid-cols-3 gap-3 rounded-lg bg-muted p-3 text-sm">
      <div><dt>{t("furniture.invoice.total")}</dt><dd className="font-bold">₹{preview.order.grandTotal}</dd></div>
      <div><dt>{t("furniture.invoice.received")}</dt><dd className="font-bold">₹{preview.order.paidTotal}</dd></div>
      <div><dt>{t("furniture.invoice.credit")}</dt><dd className="font-bold">₹{preview.order.balanceDue}</dd></div>
    </dl>
    <Label htmlFor="invoice-tax-mode">{t("furniture.invoice.tax")}</Label>
    <select id="invoice-tax-mode" value={taxMode} disabled={save.isPending} className="h-11 rounded-md border bg-background px-3"
      onChange={(event) => setTaxMode(event.target.value as typeof taxMode)}>
      <option value="">{t("furniture.invoice.chooseTax")}</option>
      <option value="none">{t("furniture.invoice.noGst")}</option>
      <option value="inclusive">{t("furniture.invoice.inclusive")}</option>
    </select>
    <div className="space-y-3">
      {preview.lines.map((line, index) => <div key={line.lineId} className="rounded-lg border p-3">
        <p className="text-sm font-semibold">{line.name} · {line.quantity} {line.enteredUnit} · ₹{line.amount}</p>
        {taxMode === "inclusive" && <div className="mt-2 grid grid-cols-2 gap-3">
          <div><Label htmlFor={`invoice-tax-${index}`}>{t("furniture.invoice.gstRate")}</Label>
            <Input id={`invoice-tax-${index}`} className="h-11" type="number" min="0" max="100" step="0.01" disabled={save.isPending}
              value={taxes[index].gstRate} onChange={(event) => setTaxes((rows) => rows.map((row, i) => i === index ? { ...row, gstRate: Number(event.target.value) } : row))} /></div>
          <div><Label htmlFor={`invoice-hsn-${index}`}>{t("furniture.invoice.hsn")}</Label>
            <Input id={`invoice-hsn-${index}`} className="h-11" inputMode="numeric" disabled={save.isPending || Boolean(line.productId && line.hsn)} value={taxes[index].hsn}
              onChange={(event) => setTaxes((rows) => rows.map((row, i) => i === index ? { ...row, hsn: event.target.value } : row))} /></div>
        </div>}
      </div>)}
    </div>
    {!preview.order.customerId && preview.order.balanceDue > 0 && <>
      <Label htmlFor="invoice-customer">{t("furniture.invoice.customer")}</Label>
      <select id="invoice-customer" className="h-11 rounded-md border bg-background px-3" value={customerId} disabled={save.isPending} onChange={(event) => setCustomerId(event.target.value)}>
        <option value="">{t("furniture.invoice.chooseCustomer")}</option>
        {preview.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.mobile}</option>)}
      </select>
      {preview.customers.length === 0 && <p className="text-sm text-amber-800">{t("furniture.invoice.noCustomer")}</p>}
    </>}
    <Label htmlFor="invoice-reason">{t("furniture.invoice.reason")}</Label>
    <Input id="invoice-reason" className="h-11" value={reason} disabled={save.isPending} maxLength={500} onChange={(event) => setReason(event.target.value)} />
    <Label htmlFor="invoice-pin">{t("rental.refund.pin")}</Label>
    <Input id="invoice-pin" className="h-11" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} disabled={save.isPending} onChange={(event) => setPin(event.target.value)} />
    {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
    <Button className="h-11" disabled={save.isPending || (preview.legacyDelivery && (!businessDate || !legacyStockConfirmed)) || !taxMode || needsCustomer || !/^\d{4}$/.test(pin) || reason.trim().length < 3}
      onClick={() => save.mutate()}>{t(save.isPending ? "rental.collection.saving" : preview.legacyDelivery ? "furniture.history.repairInvoice" : "furniture.invoice.confirm")}</Button>
  </>;
}
