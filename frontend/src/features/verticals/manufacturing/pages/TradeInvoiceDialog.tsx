import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/api/http";
import { listCustomers } from "@/features/core/customers/api";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type InvoiceOrder = { id: string; orderNumber: string; customerName: string; customerId?: string | null; items: Array<{ lineTotal: number; gstRate?: number }> };
const selectClass = "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm";

export default function TradeInvoiceDialog({ order, onClose, onSaved }: { order: InvoiceOrder; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useAppLanguage();
  const [billType, setBillType] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [customerId, setCustomerId] = useState(order.customerId || "");
  const [pin, setPin] = useState("");
  const customers = useQuery({ queryKey: ["customers", "trade-invoice"], queryFn: () => listCustomers({ limit: 1000 }), enabled: paymentMode === "credit" && !order.customerId });
  const subtotal = order.items.reduce((sum, row) => sum + Number(row.lineTotal), 0);
  const gst = billType === "gst_invoice" ? order.items.reduce((sum, row) => sum + Math.round(Number(row.lineTotal) * Number(row.gstRate || 0)) / 100, 0) : 0;
  const invoice = useMutation({
    mutationFn: () => apiRequest(`/manufacturing/trade-orders/${order.id}/invoice`, { method: "POST", ownerPin: pin, body: JSON.stringify({ billType, paymentMode, ...(customerId ? { customerId } : {}) }) }),
    onSuccess: async () => { setPin(""); await onSaved(); onClose(); },
  });
  const canSave = Boolean(billType) && Boolean(paymentMode) && (paymentMode !== "credit" || Boolean(customerId)) && /^\d{4}$/.test(pin) && !invoice.isPending;
  return <Dialog open onOpenChange={(open) => { if (!open && !invoice.isPending) onClose(); }}>
    <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden p-0 sm:max-w-lg" onEscapeKeyDown={(event) => { if (invoice.isPending) event.preventDefault(); }} onInteractOutside={(event) => { if (invoice.isPending) event.preventDefault(); }}>
      <DialogHeader className="px-5 pt-5 text-left">
        <DialogTitle>{t("manufacturing.invoice.title")}</DialogTitle>
        <DialogDescription>{order.orderNumber} · {order.customerName}</DialogDescription>
      </DialogHeader>
      <form className="flex min-h-0 flex-col" onSubmit={(event) => { event.preventDefault(); if (canSave) invoice.mutate(); }}>
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <p className="rounded-xl bg-teal-50 p-3 text-sm leading-5 text-teal-900">{t("manufacturing.invoice.stockNotice")}</p>
          <label className="block space-y-1.5 text-sm font-semibold">{t("manufacturing.invoice.type")}
            <select className={selectClass} required value={billType} disabled={invoice.isPending} onChange={event => setBillType(event.target.value)}>
              <option value="">{t("manufacturing.invoice.chooseType")}</option>
              <option value="normal_sale">{t("manufacturing.invoice.sales")}</option><option value="gst_invoice">{t("manufacturing.invoice.gst")}</option>
            </select>
          </label>
          <label className="block space-y-1.5 text-sm font-semibold">{t("manufacturing.invoice.settlement")}
            <select className={selectClass} required value={paymentMode} disabled={invoice.isPending} onChange={event => setPaymentMode(event.target.value)}>
              <option value="">{t("manufacturing.invoice.chooseSettlement")}</option>
              <option value="credit">{t("manufacturing.invoice.unpaid")}</option><option value="bank">{t("manufacturing.invoice.bank")}</option><option value="upi">{t("manufacturing.invoice.upi")}</option><option value="cash">{t("manufacturing.invoice.cash")}</option>
            </select>
          </label>
          {paymentMode === "credit" ? <div className="space-y-2">
            {order.customerId ? <p className="text-sm">{t("manufacturing.invoice.account")}: {order.customerName}</p> : <label className="block space-y-1.5 text-sm font-semibold">{t("manufacturing.invoice.account")}
              <select className={selectClass} value={customerId} required disabled={customers.isPending || invoice.isPending} onChange={event => setCustomerId(event.target.value)}>
                <option value="">{t("manufacturing.invoice.chooseAccount")}</option>
                {(customers.data ?? []).map(customer => <option key={customer.id} value={customer.id}>{customer.name}{customer.mobile ? ` · ${customer.mobile}` : ""}</option>)}
              </select>
            </label>}
            {customers.isError ? <div role="alert" className="text-sm text-rose-700">{t("manufacturing.invoice.accountsFailed")} <Button type="button" variant="outline" onClick={() => void customers.refetch()}>{t("manufacturing.retry")}</Button></div> : !order.customerId && !customers.isPending && !customers.data?.length ? <p className="text-sm text-slate-600">{t("manufacturing.invoice.noAccounts")}</p> : null}
            <p className="text-xs leading-5 text-slate-600">{t("manufacturing.invoice.creditNotice")}</p>
          </div> : paymentMode ? <p className="text-xs leading-5 text-slate-600">{t("manufacturing.invoice.paidNotice")}</p> : null}
          <div className="rounded-xl border border-slate-200 p-3 text-sm">
            <div className="flex justify-between gap-3"><span>{t("manufacturing.invoice.subtotal")}</span><span>₹{subtotal.toFixed(2)}</span></div>
            <div className="mt-1 flex justify-between gap-3"><span>{t("manufacturing.invoice.tax")}</span><span>₹{gst.toFixed(2)}</span></div>
            <div className="mt-2 flex justify-between gap-3 border-t pt-2 font-bold"><span>{t("manufacturing.invoice.total")}</span><span>₹{(subtotal + gst).toFixed(2)}</span></div>
          </div>
          <label className="block space-y-1.5 text-sm font-semibold">{t("manufacturing.orders.ownerPin")}
            <Input className="h-11" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} disabled={invoice.isPending} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} />
          </label>
          {invoice.isError ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{invoice.error instanceof Error ? invoice.error.message : t("manufacturing.orders.failedDetail")}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2 border-t bg-white px-5 py-4">
          <Button type="button" variant="outline" className="min-h-11" disabled={invoice.isPending} onClick={onClose}>{t("manufacturing.orders.close")}</Button>
          <Button type="submit" className="min-h-11 flex-1 gap-2" disabled={!canSave}>{invoice.isPending ? <Loader2 size={16} className="animate-spin" /> : null}{t("manufacturing.invoice.create")}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
