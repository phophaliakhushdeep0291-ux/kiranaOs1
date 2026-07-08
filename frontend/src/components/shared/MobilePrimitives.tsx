import type { HTMLAttributes, ReactNode } from "react";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

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
          <h2 className="truncate font-display text-[18px] font-black leading-tight tracking-normal text-[#07133f]">{title}</h2>
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
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-[15px] bg-[#edf4ff] text-[#075fff] shadow-[0_8px_18px_rgba(7,95,255,0.08)]">{icon}</div>
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
