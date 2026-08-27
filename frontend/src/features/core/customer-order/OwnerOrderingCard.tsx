import { useMemo, useState } from "react";
import { restaurantGuestUrl } from "./restaurant-website";
import { Check, Copy, ExternalLink, Printer, QrCode } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardHead, RowToggle } from "@/features/core/settings/ui";
import { QrCodeView } from "@/lib/qr/QrCodeView";
import { encodeQrSvg } from "@/lib/qr/qr-encoder";

/**
 * Owner control for QR customer self-order. Presentational on purpose — the opt-in flag is owned
 * by the parent page's single useSettingsPrefs() instance and passed in, so we never run a second
 * settings-prefs hook on the same page (which would clobber the shared settingsJson blob).
 */
export function OwnerOrderingCard({
  enabled,
  onToggle,
  shopId,
  websiteUrl,
}: {
  enabled: boolean;
  onToggle: (next: boolean) => void | Promise<unknown>;
  shopId: string | null;
  websiteUrl?: string | null;
}) {
  const orderUrl = useMemo(() => {
    if (!shopId) return "";
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    return restaurantGuestUrl(websiteUrl) ?? `${window.location.origin}${base}/order/${shopId}`;
  }, [shopId, websiteUrl]);

  const [copied, setCopied] = useState(false);

  function copyLink() {
    if (!orderUrl) return;
    void navigator.clipboard?.writeText(orderUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

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

  return (
    <Card>
      <CardHead icon={<QrCode size={15} />} title="Customer QR Ordering" sub="Let customers build an order on their own phone" />
      <div className="px-5 pb-5">
        <RowToggle
          label="Enable customer QR ordering"
          desc="Publishes a public order page with your catalog — item names and selling prices only (never cost, margin, or stock). Off by default."
          last
          pill={<Switch checked={enabled} onCheckedChange={onToggle} />}
        />

        {enabled && shopId && (
          <div className="mt-4 flex flex-col items-center gap-4 rounded-[12px] border border-[#e3ecf8] bg-[#f7fafe] p-5 sm:flex-row sm:items-start">
            <div className="grid shrink-0 place-items-center rounded-[12px] border border-[#e3ecf8] bg-white p-3">
              <QrCodeView value={orderUrl} size={150} title="Customer order page QR" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-[var(--brand-ink)]">Your “Order here” QR</p>
              <p className="mt-1 text-[12px] leading-relaxed text-[#52627e]">
                Print this and place it at your counter. Customers scan it, pick items on their phone, and show you a QR
                you scan to load their order into a new bill.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={copyLink}>
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy link"}
                </Button>
                <Button size="sm" variant="outline" className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={printQr}>
                  <Printer size={14} /> Print QR
                </Button>
                <a href={orderUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold">
                    <ExternalLink size={14} /> Preview
                  </Button>
                </a>
              </div>
            </div>
          </div>
        )}

        {enabled && !shopId && (
          <p className="mt-3 rounded-[10px] bg-[#fff7ed] px-3 py-2 text-[12px] font-medium text-[#c2410c]">
            Save your store profile first so your shop has an id, then the order QR will appear here.
          </p>
        )}
      </div>
    </Card>
  );
}
