import { useEffect, useRef, useState } from "react";
import { apiRequest, ApiClientError } from "@/lib/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppLanguage } from "../i18n";
import { LOCATION_CHANGED_EVENT } from "@/features/core/stores/location-context";

type MatchStatus = "matched" | "mismatch" | "missing_in_books" | "missing_in_statement" | "duplicate_review";
interface Reconciliation {
  recipientGstin: string;
  period: string;
  counts: Record<MatchStatus, number>;
  results: {
    supplierGstin: string; invoiceNumber: string; invoiceDate: string; documentType: string;
    status: MatchStatus; itcAvailability: "available" | "unavailable" | "unknown";
    booksSourceIds: string[]; statementSourceIds: string[];
    differences: { field: string; books: number | string; statement: number | string; deltaPaise?: number }[];
  }[];
}
const fields = ["taxablePaise", "cgstPaise", "sgstPaise", "igstPaise", "cessPaise", "invoiceDate"] as const;

function downloadTemplate() {
  const invoice = { sourceId: "book-1", supplierGstin: "", invoiceNumber: "INV-1", invoiceDate: "2026-09-01", documentType: "invoice", taxablePaise: 10000, cgstPaise: 900, sgstPaise: 900, igstPaise: 0, cessPaise: 0 };
  const template = { schemaVersion: "kirana-tax-reconciliation-v1", recipientGstin: "", period: "2026-09", books: [invoice], statement: [{ ...invoice, sourceId: "statement-1", itcAvailability: "unknown" }] };
  const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "tax-reconciliation-template.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TaxReconciliationPanel() {
  const { t } = useAppLanguage();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Reconciliation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"invalid" | "denied" | "failed" | null>(null);
  const [page, setPage] = useState(0);
  const active = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  function reset() {
    active.current?.abort(); active.current = null;
    setResult(null); setError(null); setBusy(false); setPage(0);
  }
  useEffect(() => {
    function locationChanged() { reset(); setFile(null); if (fileInput.current) fileInput.current.value = ""; }
    window.addEventListener(LOCATION_CHANGED_EVENT, locationChanged);
    return () => { window.removeEventListener(LOCATION_CHANGED_EVENT, locationChanged); active.current?.abort(); };
  }, []);
  async function compare() {
    reset();
    if (!file || file.size > 1_800_000) { setError("invalid"); return; }
    const controller = new AbortController(); active.current = controller; setBusy(true);
    try {
      let input: unknown;
      try { input = JSON.parse(await file.text()); }
      catch { if (!controller.signal.aborted) setError("invalid"); return; }
      if (controller.signal.aborted) return;
      const data = await apiRequest<Reconciliation>("/compliance/tax-reconciliation", { method: "POST", body: JSON.stringify(input), signal: controller.signal });
      if (!controller.signal.aborted) setResult(data);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof ApiClientError && err.status === 403 ? "denied" : err instanceof ApiClientError && err.status === 400 ? "invalid" : "failed");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const rows = result?.results.slice(page * 25, (page + 1) * 25) || [];
  return <section className="rounded-xl border bg-white p-5 lg:col-span-2" aria-labelledby="tax-reconciliation-title">
    <h2 id="tax-reconciliation-title" className="font-bold">{t("settings.taxRecon.title")}</h2>
    <p className="mt-2 text-sm text-slate-600">{t("settings.taxRecon.intro")}</p>
    <p className="mt-2 text-sm text-slate-600">{t("settings.taxRecon.format")}</p>
    <div className="my-4 flex flex-wrap items-end gap-3">
      <Button type="button" variant="outline" onClick={downloadTemplate}>{t("settings.taxRecon.template")}</Button>
      <label className="text-sm">{t("settings.taxRecon.file")}<Input ref={fileInput} type="file" accept=".json,application/json" onChange={(event) => { reset(); setFile(event.target.files?.[0] || null); }} /></label>
      <Button type="button" disabled={!file || busy} onClick={() => void compare()}>{t(busy ? "settings.taxRecon.running" : "settings.taxRecon.compare")}</Button>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{t(`settings.taxRecon.${error}`)}</p>}
    {result && <div className="mt-4 space-y-3" aria-live="polite">
      <p className="font-semibold">{result.recipientGstin} · {result.period}</p>
      <div className="flex flex-wrap gap-3">{(Object.entries(result.counts) as [MatchStatus, number][]).map(([status, count]) => <span key={status} className="rounded bg-slate-100 px-3 py-2 text-sm">{t(`settings.taxRecon.${status}`)}: {count}</span>)}</div>
      {result.results.length === 0 && <p>{t("settings.taxRecon.empty")}</p>}
      <ul className="space-y-3">{rows.map((row, index) => <li key={`${page}-${index}`} className="rounded-lg border p-3 text-sm">
        <p className="break-all font-semibold">{row.invoiceNumber} · {row.supplierGstin} · {row.invoiceDate}</p>
        <p>{t(`settings.taxRecon.${row.status}`)} · {t(`settings.taxRecon.${row.itcAvailability}`)}</p>
        <p className="mt-1 break-all text-xs text-slate-600">{t("settings.taxRecon.books")}: {row.booksSourceIds.join(", ") || "—"}</p>
        <p className="break-all text-xs text-slate-600">{t("settings.taxRecon.statement")}: {row.statementSourceIds.join(", ") || "—"}</p>
        {row.differences.map((diff) => <p key={diff.field} className="mt-1 text-amber-800">
          {fields.includes(diff.field as typeof fields[number]) ? t(`settings.taxRecon.${diff.field as typeof fields[number]}`) : diff.field}: {String(diff.books)} → {String(diff.statement)}
        </p>)}
      </li>)}</ul>
      {result.results.length > 25 && <div className="flex items-center gap-3">
        <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>{t("settings.taxRecon.previous")}</Button>
        <span>{page + 1} / {Math.ceil(result.results.length / 25)}</span>
        <Button variant="outline" disabled={(page + 1) * 25 >= result.results.length} onClick={() => setPage(page + 1)}>{t("settings.taxRecon.next")}</Button>
      </div>}
    </div>}
    <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm">{t("settings.taxRecon.limits")}</p>
  </section>;
}
