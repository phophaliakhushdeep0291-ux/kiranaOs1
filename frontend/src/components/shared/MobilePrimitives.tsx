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
    <section className={cn("md:hidden rounded-[18px] border border-[#e4ebf4] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]", className)} {...props}>
      <div className="flex items-start justify-between gap-3 border-b border-[#edf2f8] px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-extrabold leading-tight text-[#07133f]">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs font-medium text-[#64708b]">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="p-3.5">{children}</div>
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
        "flex min-h-[76px] items-center gap-3 rounded-[16px] border border-[#e5ebf3] bg-white px-3.5 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.045)]",
        className,
      )}
      {...props}
    >
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-extrabold leading-tight text-[#07133f]">{title}</div>
        {subtitle ? <div className="mt-1 truncate text-xs font-medium text-[#53617d]">{subtitle}</div> : null}
        {meta ? <div className="mt-1 text-[11px] font-medium text-[#77839c]">{meta}</div> : null}
      </div>
      {(amount || status || action) ? (
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          {amount ? <div className="text-[14px] font-extrabold text-[#07133f]">{amount}</div> : null}
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
        <MobileListCardInner {...props} className={cn("cursor-pointer active:scale-[0.99]", props.className)} />
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
    <div className={cn("md:hidden grid grid-cols-2 gap-3 min-[430px]:grid-cols-3", className)} {...props}>
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
      className={cn("rounded-[16px] border border-[#e4ebf4] bg-white p-3.5 text-center shadow-[0_8px_24px_rgba(15,23,42,0.045)]", className)}
      {...props}
    >
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-[14px] bg-blue-50 text-blue-700">{icon}</div>
      <div className="mt-2 text-[13px] font-extrabold text-[#07133f]">{label}</div>
      {helper ? <div className="mt-1 text-[11px] font-medium text-[#64708b]">{helper}</div> : null}
    </div>
  );
}

export function MobileActionTile({ href, ...props }: MobileActionTileProps) {
  if (href) {
    return (
      <Link href={href}>
        <MobileActionTileInner {...props} className={cn("cursor-pointer active:scale-[0.99]", props.className)} />
      </Link>
    );
  }

  return <MobileActionTileInner {...props} />;
}
