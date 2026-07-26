// Shared presentation pieces for the Financial Assurance module.
//
// Deliberately small and local to this feature: the rest of KiranaOS is not
// being redesigned, so these only reuse existing primitives.
import { cn } from "@/lib/utils";
import { CHIP_TONES } from "@/lib/chip-tones";
import type { EvidenceStatus, FindingStatus, RiskLevel } from "./api";

export const RISK_TONE: Record<RiskLevel, string> = {
  LOW: CHIP_TONES.gray,
  MEDIUM: CHIP_TONES.blue,
  HIGH: CHIP_TONES.amber,
  CRITICAL: CHIP_TONES.red,
};

export const STATUS_TONE: Record<FindingStatus, string> = {
  OPEN: CHIP_TONES.blue,
  EVIDENCE_REQUESTED: CHIP_TONES.violet,
  UNDER_REVIEW: CHIP_TONES.amber,
  CONFIRMED_ISSUE: CHIP_TONES.red,
  FALSE_POSITIVE: CHIP_TONES.gray,
  CORRECTED: CHIP_TONES.green,
  ACCEPTED_RISK: CHIP_TONES.gray,
  CLOSED: CHIP_TONES.gray,
};

export const EVIDENCE_TONE: Record<EvidenceStatus, string> = {
  REQUESTED: CHIP_TONES.violet,
  PROVIDED: CHIP_TONES.blue,
  VERIFIED: CHIP_TONES.green,
  REJECTED: CHIP_TONES.red,
  INSUFFICIENT: CHIP_TONES.amber,
  NOT_APPLICABLE: CHIP_TONES.gray,
};

export function humanize(value: string | null | undefined) {
  if (!value) return "—";
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function inr(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function inrFromPaise(paise: number | null | undefined) {
  if (paise === null || paise === undefined) return "—";
  return inr(Number(paise) / 100);
}

export function fmtDateTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function Chip({ tone, children, className }: { tone?: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", tone ?? CHIP_TONES.gray, className)}>
      {children}
    </span>
  );
}

export function RiskChip({ level, score }: { level: RiskLevel; score?: number }) {
  return (
    <Chip tone={RISK_TONE[level]}>
      {level}
      {score !== undefined ? ` · ${score}` : ""}
    </Chip>
  );
}

export function StatusChip({ status }: { status: FindingStatus }) {
  return <Chip tone={STATUS_TONE[status]}>{humanize(status)}</Chip>;
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// Shown on every assurance surface. The product must never read as a statutory
// audit or as an accusation, so this is a component rather than ad-hoc copy.
export function AssuranceDisclaimer({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs leading-relaxed text-muted-foreground", className)}>
      Continuous financial-control monitoring. Findings are <strong>potential inconsistencies for review</strong> — not
      proof of wrongdoing, not a statutory audit, and not a substitute for your Chartered Accountant.
    </p>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const tone = clamped >= 80 ? "bg-red-500" : clamped >= 55 ? "bg-amber-500" : clamped >= 30 ? "bg-blue-500" : "bg-slate-400";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Risk score ${clamped} of 100`}>
      <div className={cn("h-full rounded-full", tone)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

/** Renders a rule's `details` object as readable label/value rows. */
export function DetailGrid({ details }: { details: Record<string, unknown> }) {
  const entries = Object.entries(details ?? {});
  if (!entries.length) return null;
  return (
    <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-dashed border-border/60 py-1">
          <dt className="text-xs text-muted-foreground">{humanize(key)}</dt>
          <dd className="text-xs font-medium tabular-nums">{formatDetailValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-IN", { maximumFractionDigits: 4 });
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return fmtDateTime(value);
    return value;
  }
  if (Array.isArray(value)) {
    if (!value.length) return "—";
    if (value.every((item) => typeof item !== "object")) return value.join(", ");
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  return JSON.stringify(value);
}
