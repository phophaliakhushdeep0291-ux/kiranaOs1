import { useMemo, useState } from "react";
import { Printer, QrCode, X } from "lucide-react";
import { useAuth } from "@/features/core/auth/useAuth";
import { useSettingsPrefs } from "@/features/core/settings/use-settings-prefs";
import { QrCodeView } from "@/lib/qr/QrCodeView";
import { encodeQrSvg } from "@/lib/qr/qr-encoder";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

/**
 * Billing-screen shortcut to the shop's "Order here" QR. Always visible so owners can FIND the
 * feature: when QR ordering is still off, the same dialog explains it and turns it on in one tap
 * (writes settingsJson.customerOrdering.enabled through the shared settings-prefs blob).
 */
export function BillingOrderQrButton() {
  const { shop } = useAuth();
  const { prefs, patch, hydrated } = useSettingsPrefs();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const shopId = shop?.id ?? null;

  const enabled = useMemo(() => {
    const fromPrefs = (prefs.customerOrdering as { enabled?: boolean } | undefined)?.enabled;
    if (typeof fromPrefs === "boolean") return fromPrefs;
    try {
      return JSON.parse(shop?.settingsJson ?? "{}")?.customerOrdering?.enabled === true;
    } catch {
      return false;
    }
  }, [prefs.customerOrdering, shop?.settingsJson]);

  const orderUrl = useMemo(() => {
    if (!shopId) return "";
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    return `${window.location.origin}${base}/order/${shopId}`;
  }, [shopId]);

  function printQr() {
    if (!orderUrl) return;
    const svg = encodeQrSvg(orderUrl, { border: 2 });
    const w = window.open("", "_blank", "width=420,height=560");
    if (!w) return;
    w.document.write(
      `<!doctype html><html><head><title>Order here</title></head>` +
        `<body style="font-family:system-ui,sans-serif;text-align:center;padding:28px;margin:0">` +
        `<h2 style="margin:0 0 4px">Scan to order</h2>` +
        `<p style="margin:0 0 16px;color:#555">Pick your items, show the QR at the counter</p>` +
        `<div style="width:320px;height:320px;margin:0 auto">${svg}</div>` +
        `<p style="margin-top:16px;font-size:12px;color:#888;word-break:break-all">${orderUrl}</p>` +
        `<script>window.onload=function(){window.print()}</script></body></html>`,
    );
    w.document.close();
  }

  if (!shopId) return null;

  return (
    <>
      {/* A poster-printing shortcut used once a season used to own a whole row of
          the billing screen, with an empty half-screen beside it. It now rides at
          the end of the category rail: still one tap away, and it costs the
          product grid — the only thing that screen is actually for — nothing. */}
      <button
        type="button"
        data-testid="button-order-qr"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[8px] border border-[var(--brand-border)] bg-[#eaf2ff] px-4 text-[12.5px] font-bold text-[var(--brand)] transition-colors hover:bg-[#dfeaff] lg:mouse:h-9"
      >
        <QrCode size={14} aria-hidden="true" /> Order QR
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1424]/70 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="w-[min(92vw,360px)] rounded-3xl bg-white p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-display text-base font-black text-[var(--brand-ink)]">Order here</p>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="grid h-11 w-11 place-items-center rounded-lg text-[#64748b] hover:bg-[#f1f5fb]">
                <X size={18} />
              </button>
            </div>

            {enabled ? (
              <>
                <div className="mx-auto mt-3 grid place-items-center rounded-2xl border border-[#eef2f8] p-3">
                  <QrCodeView value={orderUrl} size={244} title="Customer order page QR" />
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-[#5b6b85]">
                  Let the customer scan this to pick items on their own phone. They’ll show you a QR you scan to load the order.
                </p>
                <div className="mt-3 flex justify-center gap-2">
                  <Button size="sm" variant="outline" className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={printQr}>
                    <Printer size={14} /> Print QR
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="mx-auto mt-4 grid h-16 w-16 place-items-center rounded-2xl bg-[#eaf2ff] text-[var(--brand)]">
                  <QrCode size={30} />
                </div>
                <p className="mt-3 text-[13px] font-bold text-[var(--brand-ink)]">Customer QR ordering is off</p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-[#5b6b85]">
                  Turn it on to get a printable “Order here” QR. Customers scan it, pick items on their own phone, and
                  show you a QR that loads their order into a bill. Only item names and selling prices are shared —
                  never cost, margin, or stock.
                </p>
                <Button
                  data-testid="button-enable-qr-ordering"
                  className="mt-4 h-10 w-full rounded-[10px] text-[13px] font-bold"
                  disabled={!hydrated || enabling}
                  onClick={async () => {
                    setEnabling(true);
                    const updated = await patch({ customerOrdering: { enabled: true } }, { immediate: true });
                    if (!updated) {
                      await patch({ customerOrdering: { enabled: false } });
                      toast({
                        title: "Could not turn on QR ordering",
                        description: "Check internet/backend connection and try again. The QR stays off until the server confirms it.",
                        variant: "destructive",
                      });
                    } else {
                      toast({ title: "QR ordering turned on", description: "The customer order page is now available." });
                    }
                    setEnabling(false);
                  }}
                >
                  {enabling ? "Turning on..." : "Turn on QR ordering"}
                </Button>
                <p className="mt-2 text-[11px] text-[#8290a8]">You can turn it off anytime in Settings → Store Profile.</p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
