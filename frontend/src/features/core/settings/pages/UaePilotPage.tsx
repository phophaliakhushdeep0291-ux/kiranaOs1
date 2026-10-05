import { useMemo, useState } from "react";
import { SettingsShell } from "../SettingsShell";
import { useAppLanguage } from "../i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/money";
import { marketBusinessDate, normalizeUaeMobile } from "@/lib/market";
import { calculateUaeVatPreview, parsePreviewDecimal, uaeInvoiceKind, type VatPreviewLine } from "../uae-vat-preview";

export default function UaePilotPage() {
  const { t } = useAppLanguage();
  const [price, setPrice] = useState("105.00");
  const [quantity, setQuantity] = useState("1");
  const [discount, setDiscount] = useState("0");
  const [mode, setMode] = useState<"inclusive" | "exclusive">("inclusive");
  const [treatment, setTreatment] = useState<VatPreviewLine["treatment"]>("standard");
  const [buyerRegistered, setBuyerRegistered] = useState(false);
  const [mobile, setMobile] = useState("");
  const [openedAt] = useState(() => new Date().toISOString());
  const normalizedMobile = normalizeUaeMobile(mobile);
  const result = useMemo(() => {
    try {
      return calculateUaeVatPreview([{ id: "preview", unitPriceMinor: parsePreviewDecimal(price, 2), quantityMilli: parsePreviewDecimal(quantity, 3), treatment }], mode, parsePreviewDecimal(discount, 2));
    } catch { return null; }
  }, [price, quantity, discount, mode, treatment]);
  const money = (minor: number) => formatMoney(minor / 100, "AED");
  const inputClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground";

  return <SettingsShell>
    <header className="rounded-2xl border bg-card p-5 text-card-foreground">
      <p className="text-sm font-semibold text-primary">{t("settings.market.currency")}</p>
      <h1 className="mt-2 text-2xl font-bold">{t("settings.market.title")}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("settings.market.intro")}</p>
      <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950">{t("settings.market.preview")}</p>
    </header>

    <div className="grid gap-4 xl:grid-cols-2">
      <section className="space-y-4 rounded-2xl border bg-card p-5 text-card-foreground">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="uae-price">{t("settings.market.price")}</Label><Input id="uae-price" className="mt-1 h-11" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} /></div>
          <div><Label htmlFor="uae-quantity">{t("settings.market.quantity")}</Label><Input id="uae-quantity" className="mt-1 h-11" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>
          <div><Label htmlFor="uae-discount">{t("settings.market.discount")}</Label><Input id="uae-discount" className="mt-1 h-11" inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} /></div>
          <div><Label htmlFor="uae-treatment">{t("settings.market.treatment")}</Label><select id="uae-treatment" className={`${inputClass} mt-1`} value={treatment} onChange={(event) => setTreatment(event.target.value as VatPreviewLine["treatment"])}>
            <option value="standard">{t("settings.market.standard")}</option><option value="zero">{t("settings.market.zero")}</option><option value="exempt">{t("settings.market.exempt")}</option>
          </select></div>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={mode === "inclusive"} onChange={(event) => setMode(event.target.checked ? "inclusive" : "exclusive")} />{t(mode === "inclusive" ? "settings.market.inclusive" : "settings.market.exclusive")}</label>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={buyerRegistered} onChange={(event) => setBuyerRegistered(event.target.checked)} />{t("settings.market.buyer")}</label>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("settings.market.taxHelp")}</p>
      </section>

      <section className="rounded-2xl border bg-card p-5 text-card-foreground" aria-live="polite" aria-atomic="true">
        {result ? <>
          <h2 className="font-bold">{t(treatment === "exempt" ? "settings.market.exempt" : uaeInvoiceKind(buyerRegistered, result.totalMinor) === "full" ? "settings.market.full" : "settings.market.simplified")}</h2>
          <dl className="mt-5 space-y-4 text-sm">
            <div className="flex justify-between gap-3"><dt>{t("settings.market.net")}</dt><dd className="font-semibold tabular-nums">{money(result.netMinor)}</dd></div>
            <div className="flex justify-between gap-3"><dt>{t("settings.market.vat")}</dt><dd className="font-semibold tabular-nums">{money(result.vatMinor)}</dd></div>
            <div className="flex justify-between gap-3 border-t pt-4 text-lg"><dt className="font-bold">{t("settings.market.total")}</dt><dd className="font-bold tabular-nums">{money(result.totalMinor)}</dd></div>
            <div className="flex justify-between gap-3 text-muted-foreground"><dt>{t("settings.market.date")}</dt><dd>{marketBusinessDate(openedAt, "AE")}</dd></div>
          </dl>
          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">{t(treatment === "exempt" ? "settings.market.taxHelp" : "settings.market.documentHelp")}</p>
        </> : <p role="alert" className="text-sm text-destructive">{t("settings.market.invalid")}</p>}
      </section>
    </div>

    <section className="rounded-2xl border bg-card p-5 text-card-foreground">
      <h2 className="font-bold">{t("settings.market.contact")}</h2>
      <div className="mt-3 max-w-sm"><Label htmlFor="uae-mobile">{t("settings.market.mobile")}</Label><Input id="uae-mobile" type="tel" autoComplete="off" className="mt-1 h-11" value={mobile} onChange={(event) => setMobile(event.target.value)} aria-describedby="uae-mobile-help" /></div>
      <p id="uae-mobile-help" className="mt-2 text-sm" aria-live="polite">{mobile ? normalizedMobile ?? t("settings.market.mobileInvalid") : t("settings.market.contactHelp")}</p>
    </section>

    <section className="rounded-2xl border bg-card p-5 text-card-foreground">
      <h2 className="font-bold">{t("settings.market.remaining")}</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
        <li>{t("settings.market.ledger")}</li><li>{t("settings.market.payments")}</li><li>{t("settings.market.einvoice")}</li><li>{t("settings.market.operations")}</li>
      </ul>
      <h3 className="mt-5 text-sm font-semibold">{t("settings.market.sources")}</h3>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-3 text-sm text-primary underline">
        <a href="https://tax.gov.ae/DataFolder/Files/Pdf/06-Tax-Invoices.pdf" target="_blank" rel="noopener noreferrer">{t("settings.market.fta")}</a>
        <a href="https://mof.gov.ae/en/about-us/initiatives/einvoicing/" target="_blank" rel="noopener noreferrer">{t("settings.market.mof")}</a>
        <a href="https://tdra.gov.ae/en/consumer-tool-hub/topics/porting-numbers" target="_blank" rel="noopener noreferrer">{t("settings.market.tdra")}</a>
      </div>
    </section>
  </SettingsShell>;
}
