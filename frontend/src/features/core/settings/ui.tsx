import { cloneElement, isValidElement, useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared premium-card building blocks for every Settings page, so all tabs share
 * the same card style, badges, KPI tiles, rows and form fields. The General
 * overview screenshot is the visual source of truth.
 */

export type Tone = "blue" | "green" | "amber" | "red" | "gray" | "violet";

// Vivid mid-tone text on a soft tint — matches the reference chips (see lib/chip-tones).
const BADGE_TONES: Record<Tone, string> = {
  blue: "bg-[#e8f0fe] text-[var(--brand)]",
  green: "bg-[#e6f7ee] text-[#16a34a]",
  amber: "bg-[#fdf3e1] text-[#d97706]",
  red: "bg-[#fdebeb] text-[#ef4444]",
  gray: "bg-[#eef2f7] text-[#64748b]",
  violet: "bg-[#f1ecfe] text-[#7c3aed]",
};

const KPI_TONES: Record<Tone, { ring: string; value: string }> = {
  blue: { ring: "bg-[var(--brand-soft)] text-[var(--brand)]", value: "text-[var(--brand-ink)]" },
  green: { ring: "bg-emerald-50 text-emerald-600", value: "text-[var(--brand-ink)]" },
  amber: { ring: "bg-amber-50 text-amber-600", value: "text-[var(--brand-ink)]" },
  red: { ring: "bg-rose-50 text-rose-600", value: "text-[var(--brand-ink)]" },
  gray: { ring: "bg-[#eef2f8] text-[#64748b]", value: "text-[var(--brand-ink)]" },
  violet: { ring: "bg-violet-50 text-violet-600", value: "text-[var(--brand-ink)]" },
};

function labelControl(node: ReactNode, label: string, descriptionId?: string) {
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  return cloneElement(element, {
    "aria-label": element.props["aria-label"] ?? label,
    "aria-describedby": element.props["aria-describedby"] ?? descriptionId,
  });
}

export function Card({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <div id={id} className={cn("min-w-0 scroll-mt-4 overflow-hidden rounded-[14px] border border-[#e7edf7] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]", className)}>
      {children}
    </div>
  );
}

export function CardHead({ icon, title, sub, action }: { icon?: ReactNode; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 px-5 pb-3 pt-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-[var(--brand-soft)] text-[var(--brand)]">{icon}</span>}
        <div className="min-w-0">
          <h3 className="truncate font-display text-[14px] font-black tracking-tight text-[var(--brand-ink)]">{title}</h3>
          {sub && <p className="line-clamp-2 text-[11px] text-[#64748b]">{sub}</p>}
        </div>
      </div>
      {action && <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 self-start sm:self-auto">{action}</div>}
    </div>
  );
}

export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-[7px] px-2 py-[3px] text-[11px] font-bold", BADGE_TONES[tone], className)}>{children}</span>;
}

export function Kpi({ label, value, sub, icon, tone = "blue" }: { label: string; value: ReactNode; sub?: string; icon?: ReactNode; tone?: Tone }) {
  const t = KPI_TONES[tone];
  return (
    <div className="min-w-0 rounded-[12px] border border-[#e7edf7] bg-white px-4 py-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[11px] font-semibold text-[#64748b]">{label}</p>
        {icon && <span className={cn("grid h-7 w-7 place-items-center rounded-[8px]", t.ring)}>{icon}</span>}
      </div>
      <p className={cn("mt-1 break-words font-display text-[22px] font-black leading-tight", t.value)}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-[#9aa6bb]">{sub}</p>}
    </div>
  );
}

export function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold text-[#64748b]">{label}</p>
      <p className="truncate text-[13px] font-bold text-[var(--brand-ink)]">{value}</p>
    </div>
  );
}

export function RowToggle({ label, desc, pill, last }: { label: string; desc?: string; pill: ReactNode; last?: boolean }) {
  const id = useId().replace(/:/g, "");
  const descriptionId = desc ? `setting-description-${id}` : undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-3", !last && "border-b border-[#eef2f8]")}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-[var(--brand-ink)]">{label}</p>
        {desc && <p id={descriptionId} className="truncate text-[11px] text-[#64748b]">{desc}</p>}
      </div>
      <div className="flex min-w-0 shrink-0 justify-start sm:justify-end">{labelControl(pill, label, descriptionId)}</div>
    </div>
  );
}

export function Fld({ label, err, hint, children }: { label: string; err?: string; hint?: string; children: ReactNode }) {
  const id = useId().replace(/:/g, "");
  const labelId = `setting-label-${id}`;
  const descriptionId = err ? `setting-error-${id}` : hint ? `setting-hint-${id}` : undefined;
  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const control = groupRef.current?.querySelector<HTMLElement>("input, textarea, select, button, [role='combobox'], [role='switch']");
    if (!control) return;
    if (!control.hasAttribute("aria-label") && !control.hasAttribute("aria-labelledby")) control.setAttribute("aria-labelledby", labelId);
    if (descriptionId && !control.hasAttribute("aria-describedby")) control.setAttribute("aria-describedby", descriptionId);
  }, [descriptionId, labelId]);

  return (
    <div ref={groupRef} className="min-w-0" role="group" aria-labelledby={labelId} aria-describedby={descriptionId}>
      <span id={labelId} className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{label}</span>
      {labelControl(children, label, descriptionId)}
      {hint && !err && <p id={descriptionId} className="mt-1 text-[11px] text-[#9aa6bb]">{hint}</p>}
      {err && <p id={descriptionId} role="alert" aria-live="polite" className="mt-1 text-[11px] text-rose-600">{err}</p>}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h4 className="text-[13px] font-black text-[#13274d]">{children}</h4>;
}

/** Section header above a content area (used for page-level intros inside cards). */
export function CardSection({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("px-5 pb-5", className)}>
      {title && <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#9aa6bb]">{title}</p>}
      {children}
    </div>
  );
}
