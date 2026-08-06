import { cn } from "@/lib/utils";

// The Artha mark: an "A" whose crossbar runs past the right leg and becomes a
// ledger rule — the khata line the counter already keeps. Drawn on lucide's 24
// grid at stroke-width 2 so it sits correctly beside the lucide icons it shares
// a row with, and stroked in currentColor so the surrounding tile keeps owning
// the colour. The same geometry is scaled up in public/favicon.svg and
// public/icons/kiranaos-icon.svg; change one, change all three. Those two are
// inset a further 8% because the icon is declared maskable — Android clips to
// the central 80% circle, which the untightened leg tips fell outside of.

export interface BrandMarkProps {
  size?: number;
  className?: string;
  /** Sets an accessible name. Omit for decorative use next to the wordmark. */
  title?: string;
}

export function BrandMark({ size = 24, className, title }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path d="M4.8 20 11 4l6.2 16" />
      <path d="M7.7 15h11.5" />
    </svg>
  );
}
