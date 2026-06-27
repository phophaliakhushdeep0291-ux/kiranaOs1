import { useMemo, useState } from "react";
import { QrCode, X } from "lucide-react";
import { useAuth } from "@/features/auth/useAuth";
import { QrCodeView } from "@/lib/qr/QrCodeView";

/**
 * Compact billing-screen shortcut to the shop's "Order here" QR, so the owner can show it to a
 * customer without leaving Billing. Renders nothing unless the owner has opted in
 * (settingsJson.customerOrdering.enabled) — so it stays invisible for shops that don't use it.
 */
function orderingEnabled(settingsJson?: string | null): boolean {
  if (!settingsJson) return false;
  try {
    return JSON.parse(settingsJson)?.customerOrdering?.enabled === true;
  } catch {
    return false;
  }
}

export function BillingOrderQrButton() {
  const { shop } = useAuth();
  const [open, setOpen] = useState(false);
  const shopId = shop?.id ?? null;
  const enabled = orderingEnabled(shop?.settingsJson);

  const orderUrl = useMemo(() => {
    if (!shopId) return "";
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    return `${window.location.origin}${base}/order/${shopId}`;
  }, [shopId]);

  if (!enabled || !shopId) return null;

  return (
    <>
      <div className="mb-1.5 flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#cfe0ff] bg-[#eaf2ff] px-2.5 py-1.5 text-[12px] font-bold text-[#075fff]"
        >
          <QrCode size={14} /> Order QR
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1424]/70 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="w-[min(92vw,360px)] rounded-3xl bg-white p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-display text-base font-black text-[#102347]">Order here</p>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-[#64748b] hover:bg-[#f1f5fb]">
                <X size={18} />
              </button>
            </div>
            <div className="mx-auto mt-3 grid place-items-center rounded-2xl border border-[#eef2f8] p-3">
              <QrCodeView value={orderUrl} size={244} title="Customer order page QR" />
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-[#5b6b85]">
              Let the customer scan this to pick items on their own phone. They’ll show you a QR you scan to load the order.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
