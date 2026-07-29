import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { Link } from "wouter";
import { CheckCircle2, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MobilePageProps extends HTMLAttributes<HTMLDivElement> {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function MobilePage({ title, subtitle, actions, children, className, ...props }: MobilePageProps) {
  return (
    <div className={cn("kirana-mobile-page md:hidden", className)} {...props}>
      {(title || subtitle || actions) ? (
        <div className="kirana-mobile-page-heading">
          <div className="min-w-0">
            {title ? <h1 className="kirana-mobile-title">{title}</h1> : null}
            {subtitle ? <p className="kirana-mobile-subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="kirana-mobile-heading-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export interface MobileSyncStripProps extends HTMLAttributes<HTMLElement> {
  status?: "synced" | "syncing" | "offline" | "attention";
  label?: ReactNode;
  detail?: ReactNode;
  actionLabel?: ReactNode;
  href?: string;
  onAction?: () => void;
}

export function MobileSyncStrip({
  status = "synced",
  label,
  detail,
  actionLabel = "Sync Now",
  href = "/sync-status",
  onAction,
  className,
  ...props
}: MobileSyncStripProps) {
  const isGood = status === "synced";
  const isBusy = status === "syncing";
  const tone = isGood ? "good" : status === "offline" ? "offline" : "attention";
  const icon = isBusy ? <RefreshCw className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />;
  const content = (
    <button type="button" onClick={onAction} className="kirana-mobile-sync-action">
      <RefreshCw className="h-4 w-4" />
      {actionLabel}
    </button>
  );

  return (
    <section className={cn("kirana-mobile-sync-strip", `kirana-mobile-sync-${tone}`, className)} {...props}>
      <div className="kirana-mobile-sync-icon">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="kirana-mobile-sync-label">{label ?? (isBusy ? "Syncing" : isGood ? "Synced" : status === "offline" ? "Offline safe" : "Review sync")}</p>
        <p className="kirana-mobile-sync-detail">{detail ?? (isGood ? "Just now" : status === "offline" ? "Saved on this device" : "Some changes need retry")}</p>
      </div>
      {onAction ? content : <Link href={href}>{content}</Link>}
    </section>
  );
}

export interface MobileKpiGridProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function MobileKpiGrid({ children, className, ...props }: MobileKpiGridProps) {
  return (
    <div className={cn("kirana-mobile-kpi-grid", className)} {...props}>
      {children}
    </div>
  );
}

export interface MobileKpiCardProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  trend?: ReactNode;
  trendTone?: "up" | "down" | "neutral";
  sparkline?: number[];
  tone?: "blue" | "green" | "violet" | "orange" | "red";
}

const mobileKpiToneClass: Record<NonNullable<MobileKpiCardProps["tone"]>, string> = {
  blue: "kirana-mobile-kpi-blue",
  green: "kirana-mobile-kpi-green",
  violet: "kirana-mobile-kpi-violet",
  orange: "kirana-mobile-kpi-orange",
  red: "kirana-mobile-kpi-red",
};

function sparklinePoints(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map((value, index) => {
    const x = values.length === 1 ? 100 : (index / (values.length - 1)) * 100;
    const y = 28 - ((value - min) / range) * 22;
    return `${x},${y}`;
  }).join(" ");
}

export function MobileKpiCard({ icon, label, value, trend, trendTone = "neutral", sparkline, tone = "blue", className, ...props }: MobileKpiCardProps) {
  const points = sparklinePoints(sparkline ?? []);
  return (
    <div className={cn("kirana-mobile-kpi-card", mobileKpiToneClass[tone], className)} {...props}>
      <div className="flex min-w-0 items-center gap-2">
        {icon ? <span className="kirana-mobile-kpi-icon">{icon}</span> : null}
        <span className="kirana-mobile-kpi-label">{label}</span>
      </div>
      <div className="kirana-mobile-kpi-value">{value}</div>
      {trend ? <div className={cn("kirana-mobile-kpi-trend", `kirana-mobile-trend-${trendTone}`)}>{trend}</div> : null}
      {points ? (
        <svg className="kirana-mobile-kpi-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </div>
  );
}

export interface MobileToolbarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function MobileToolbar({ children, className, ...props }: MobileToolbarProps) {
  return (
    <div className={cn("kirana-mobile-toolbar", className)} {...props}>
      {children}
    </div>
  );
}

export interface MobilePillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function MobilePillButton({ active, className, ...props }: MobilePillButtonProps) {
  return <button type="button" className={cn("kirana-mobile-pill", active && "kirana-mobile-pill-active", className)} {...props} />;
}

// Omit the native string `title` attribute so these cards can take rich ReactNode titles.
export interface MobileSectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

export function MobileSection({ title, subtitle, action, children, className, ...props }: MobileSectionProps) {
  return (
    <section className={cn("mobile-card-premium md:hidden overflow-hidden rounded-[20px]", className)} {...props}>
      <div className="flex min-h-[58px] items-start justify-between gap-3 border-b border-[#edf2f8] px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate font-display text-[18px] font-extrabold leading-tight tracking-normal text-[#07133f]">{title}</h2>
          {subtitle ? <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-snug text-[#64708b]">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="p-3.5 sm:p-4">{children}</div>
    </section>
  );
}

export interface MobileListCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  amount?: ReactNode;
  status?: ReactNode;
  href?: string;
  action?: ReactNode;
}

function MobileListCardInner({ leading, title, subtitle, meta, amount, status, action, className, ...props }: Omit<MobileListCardProps, "href">) {
  return (
    <div
      className={cn(
        "flex min-h-[82px] items-center gap-3 rounded-[18px] border border-[#e2eaf5] bg-white px-3.5 py-3 shadow-[0_9px_26px_rgba(15,35,80,0.045)] transition-transform duration-150",
        className,
      )}
      {...props}
    >
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-black leading-tight text-[#07133f]">{title}</div>
        {subtitle ? <div className="mt-1 truncate text-[12px] font-medium text-[#53617d]">{subtitle}</div> : null}
        {meta ? <div className="mt-1 line-clamp-2 text-[11px] font-medium leading-snug text-[#77839c]">{meta}</div> : null}
      </div>
      {(amount || status || action) ? (
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          {amount ? <div className="text-[15px] font-black text-[#07133f]">{amount}</div> : null}
          {status ? <div>{status}</div> : null}
          {action ?? <ChevronRight className="h-4 w-4 text-[#44527a]" />}
        </div>
      ) : null}
    </div>
  );
}

export function MobileListCard({ href, ...props }: MobileListCardProps) {
  if (href) {
    return (
      <Link href={href}>
        <MobileListCardInner {...props} className={cn("cursor-pointer active:scale-[0.985]", props.className)} />
      </Link>
    );
  }

  return <MobileListCardInner {...props} />;
}

export interface MobileActionGridProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function MobileActionGrid({ children, className, ...props }: MobileActionGridProps) {
  return (
    <div className={cn("md:hidden grid grid-cols-2 gap-3.5 min-[430px]:grid-cols-3", className)} {...props}>
      {children}
    </div>
  );
}

export interface MobileActionTileProps extends HTMLAttributes<HTMLDivElement> {
  icon: ReactNode;
  label: ReactNode;
  helper?: ReactNode;
  href?: string;
}

function MobileActionTileInner({ icon, label, helper, className, ...props }: Omit<MobileActionTileProps, "href">) {
  return (
    <div
      className={cn("mobile-action-surface p-3.5 text-center transition-transform duration-150", className)}
      {...props}
    >
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-[15px] bg-[var(--brand-soft)] text-[var(--brand)] shadow-[0_8px_18px_rgba(7,95,255,0.08)]">{icon}</div>
      <div className="mt-2 text-[13px] font-black leading-tight text-[#07133f]">{label}</div>
      {helper ? <div className="mt-1 text-[11px] font-medium leading-snug text-[#64708b]">{helper}</div> : null}
    </div>
  );
}

export function MobileActionTile({ href, ...props }: MobileActionTileProps) {
  if (href) {
    return (
      <Link href={href}>
        <MobileActionTileInner {...props} className={cn("cursor-pointer active:scale-[0.985]", props.className)} />
      </Link>
    );
  }

  return <MobileActionTileInner {...props} />;
}
