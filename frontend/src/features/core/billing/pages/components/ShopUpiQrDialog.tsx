import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrCodeView } from "@/lib/qr/QrCodeView";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { createShopUpiCollection, type ShopUpiCollection } from "@/features/core/billing/shop-upi-qr";

interface ShopUpiQrDialogProps {
  open: boolean;
  amountPaise: number;
  /** Shown to the guest in their UPI app, e.g. the table name. */
  note?: string;
  /** The shop's own reference, so day close can match this against a statement. */
  reference?: string;
  /** Called when the cashier confirms the money arrived, with the UTR if they typed one. */
  onReceived: (upiReference?: string) => void;
  onClose: () => void;
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The shop's own UPI QR, shown at the counter for a guest to scan.
 *
 * There is no gateway behind this and therefore nothing to poll. The money moves
 * between the guest's bank and the shop's, and this software is never told that
 * it did — so this dialog deliberately does not look like the provider one.
 * There is no spinner waiting for a confirmation that will never arrive, and no
 * green tick until a person presses one.
 *
 * The warning is the feature, not decoration. Taking a guest's "payment
 * successful" screen at face value is the oldest scam at an Indian counter: the
 * screenshot can be from last Tuesday. The cashier confirms from their own bank
 * alert, and the UTR they read back is what makes an otherwise unverifiable
 * claim reconcilable at day close.
 */
export function ShopUpiQrDialog({ open, amountPaise, note, reference, onReceived, onClose }: ShopUpiQrDialogProps) {
  const { t } = useAppLanguage();
  const [collection, setCollection] = useState<ShopUpiCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [utr, setUtr] = useState("");

  useEffect(() => {
    if (!open) {
      setCollection(null);
      setError(null);
      setUtr("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    createShopUpiCollection({ amountPaise, note, reference })
      .then((next) => { if (!cancelled) setCollection(next); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("billing.upiQr.buildFailed"));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, amountPaise, note, reference, t]);

  // A UTR is 12 digits from most banks, but the string a cashier reads off an
  // alert varies by app. Accept anything plausible and let the server's own
  // pattern be the authority rather than refusing a real reference here.
  const trimmedUtr = utr.trim();
  const utrLooksWrong = trimmedUtr.length > 0 && !/^[A-Za-z0-9-]{6,35}$/.test(trimmedUtr);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode size={18} /> {t("billing.upiQr.title")}
          </DialogTitle>
          <DialogDescription>{t("billing.upiQr.subtitle", { amount: rupees(amountPaise) })}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" size={18} /> {t("billing.upiQr.building")}
          </div>
        ) : error ? (
          <div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-[13px] text-destructive">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : collection ? (
          <div className="space-y-4">
            <div className="mx-auto grid place-items-center rounded-2xl border p-4">
              <QrCodeView value={collection.link} size={236} title={t("billing.upiQr.title")} />
            </div>

            <div className="text-center">
              <div className="font-display text-2xl font-black">{rupees(collection.amountPaise)}</div>
              <div className="mt-0.5 text-[12px] text-muted-foreground">
                {collection.payeeName} · {collection.vpa}
              </div>
            </div>

            {/* The whole reason this dialog looks different from the gateway one. */}
            <div className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[12.5px] leading-relaxed text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{t("billing.upiQr.verifyYourself")}</span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="upi-utr">{t("billing.upiQr.utrLabel")}</Label>
              <Input
                id="upi-utr"
                value={utr}
                onChange={(event) => setUtr(event.target.value)}
                placeholder={t("billing.upiQr.utrPlaceholder")}
                inputMode="numeric"
                autoComplete="off"
              />
              <p className="text-[11px] text-muted-foreground">{t("billing.upiQr.utrHelp")}</p>
              {utrLooksWrong ? (
                <p className="text-[11px] font-semibold text-destructive">{t("billing.upiQr.utrInvalid")}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>{t("billing.upiQr.cancel")}</Button>
          <Button
            disabled={!collection || utrLooksWrong}
            onClick={() => onReceived(trimmedUtr || undefined)}
          >
            {t("billing.upiQr.markReceived")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
