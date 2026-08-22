import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { useAppLanguage, type TranslationKey } from "@/features/core/settings/i18n";
import { useBusinessType } from "@/features/core/settings/business-types";
import { useVisibleTradeLinks, type ShopTradeLink } from "@/features/core/settings/shop-trade-links";
import { cn } from "@/lib/utils";

export interface TradeFocusStripProps {
  /** Eyebrow above the trade name — what this screen is doing for the trade. */
  titleKey: TranslationKey;
  /** One line of guidance for this trade. */
  focusKey: TranslationKey;
  /** Trade screens worth opening from here; filtered before they are shown. */
  links: readonly ShopTradeLink[];
  className?: string;
}

/**
 * Which trade a shared screen is set up for, and where that trade goes next.
 *
 * A screen whose wording changes by business type needs somewhere to say so out
 * loud — otherwise an owner who reads "Kitchen stock" where they expected
 * "Inventory" has no way back to the cause. So the strip also carries the way to
 * the setting itself.
 */
export function TradeFocusStrip({ titleKey, focusKey, links, className }: TradeFocusStripProps) {
  const { t } = useAppLanguage();
  const { def } = useBusinessType();
  const visibleLinks = useVisibleTradeLinks(links);

  return (
    <section
      data-testid="trade-focus-strip"
      className={cn(
        "flex flex-col gap-3 rounded-[12px] border border-[var(--brand-border)] bg-[linear-gradient(135deg,#f7faff_0%,#ffffff_62%)] px-4 py-3 lg:flex-row lg:items-center lg:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--brand)]">{t(titleKey)}</p>
        <p className="mt-1 truncate text-[14px] font-bold text-[#13223f]">{def.emoji} {def.label}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-[#6d7c98]">{t(focusKey)}</p>
      </div>
      {/* `min-w-0` and wrapping: three chips plus the settings link overflow a
          375px screen, and the shell clips horizontal overflow rather than
          scrolling it, so an unwrapped row would be silently cut off.
          44px boxes on touch, dense only for a mouse — these sit 8px apart, so
          a `.tap-target` overlay would reach into its neighbour and steal taps. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {visibleLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="inline-flex min-h-11 items-center gap-1 rounded-[8px] border border-[#dfe6ef] bg-white px-2.5 text-[11px] font-semibold text-[#243653] hover:border-[var(--brand-border)] hover:text-[var(--brand)]"
          >
            {t(link.labelKey)}<ChevronRight size={13} />
          </Link>
        ))}
        <Link
          href="/settings/store-profile"
          className="inline-flex min-h-11 items-center px-1 text-[11px] font-semibold text-[var(--brand)] hover:underline"
        >
          {t("inventory.trade.changeShopType")}
        </Link>
      </div>
    </section>
  );
}
