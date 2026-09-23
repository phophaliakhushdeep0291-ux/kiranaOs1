import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppLanguage, type TranslationKey } from "../i18n";
import { LOCATION_CHANGED_EVENT } from "@/features/core/stores/location-context";

const codes = ["seller_registration", "buyer_registration", "return_reference", "hsn_review", "invalid_amount", "purchase_invoice", "purchase_match", "repeated_purchase_invoice", "expense_vendor", "sync_completeness", "gst_registration_scheme", "gst2b_itc", "expense_tax_evidence", "other_gst_adjustments", "filing_provider", "taxpayer_year", "all_businesses", "ais_26as", "other_income", "stock_assets_loans", "deductions_taxes", "regime_return_audit"] as const;
interface TaxReview {
  coverage: { invoiceCount: number; purchaseReceiptCount: number; expenseCount: number };
  findings: { code: string; count: number; sources: { type: string; id: string }[] }[];
  requiredReviews: string[];
  itrChecklist: string[];
}

function indiaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function TaxReviewPanel() {
  const { t } = useAppLanguage();
  const [from, setFrom] = useState(() => `${indiaDate().slice(0, 7)}-01`);
  const [to, setTo] = useState(indiaDate);
  const [data, setData] = useState<TaxReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  function reset() {
    request.current?.abort();
    request.current = null;
    setData(null); setError(false); setBusy(false);
  }
  useEffect(() => {
    window.addEventListener(LOCATION_CHANGED_EVENT, reset);
    return () => { window.removeEventListener(LOCATION_CHANGED_EVENT, reset); request.current?.abort(); };
  }, []);
  function label(code: string) {
    return codes.includes(code as typeof codes[number]) ? t(`settings.taxReview.${code}` as TranslationKey) : code;
  }
  async function run() {
    reset();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const result = await apiRequest<TaxReview>(`/compliance/tax-review?${new URLSearchParams({ from, to })}`, { signal: controller.signal });
      if (!controller.signal.aborted) setData(result);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return <section className="rounded-xl border bg-white p-5 lg:col-span-2" aria-labelledby="tax-review-title">
    <h2 id="tax-review-title" className="text-base font-bold">{t("settings.taxReview.title")}</h2>
    <p className="mt-1 text-sm text-slate-600">{t("settings.taxReview.intro")}</p>
    <form className="my-4 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void run(); }}>
      <label className="text-sm">{t("settings.taxReview.from")}<Input type="date" required value={from} max={to} onChange={(event) => { reset(); setFrom(event.target.value); }} /></label>
      <label className="text-sm">{t("settings.taxReview.to")}<Input type="date" required value={to} min={from} onChange={(event) => { reset(); setTo(event.target.value); }} /></label>
      <Button type="submit" disabled={busy || !from || !to}>{t(busy ? "settings.taxReview.running" : "settings.taxReview.run")}</Button>
    </form>
    <p className="text-xs text-slate-600">{t("settings.taxReview.scope")}</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{t("settings.taxReview.failed")}</p>}
    {data && <div className="mt-4 space-y-4" aria-live="polite">
      <p className="text-sm font-semibold">{t("settings.taxReview.summary", { invoices: String(data.coverage.invoiceCount), purchases: String(data.coverage.purchaseReceiptCount), expenses: String(data.coverage.expenseCount) })}</p>
      {data.findings.length === 0 ? <p className="text-sm">{t("settings.taxReview.none")}</p> : <ul className="space-y-2">
        {data.findings.map((finding) => <li key={finding.code} className="rounded-lg bg-amber-50 p-3 text-sm">
          <p className="font-semibold">{label(finding.code)} ({finding.count})</p>
          <p className="mt-1 break-all text-xs text-slate-600">{finding.sources.map((source) => source.id).join(", ")}</p>
        </li>)}
      </ul>}
      <div className="grid gap-4 md:grid-cols-2">
        {[{ title: "settings.taxReview.required" as const, items: data.requiredReviews }, { title: "settings.taxReview.itr" as const, items: data.itrChecklist }].map((group) => <div key={group.title}>
          <h3 className="font-semibold">{t(group.title)}</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-700">{group.items.map((code) => <li key={code}>{label(code)}</li>)}</ul>
        </div>)}
      </div>
    </div>}
    <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm">{t("settings.taxReview.draft")}</p>
  </section>;
}
