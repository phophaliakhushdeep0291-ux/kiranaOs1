import { useEffect, useState, type ReactNode } from "react";

interface RouteTransitionProps {
  children: ReactNode;
  routeKey: string;
}

export function RouteTransition({ children, routeKey }: RouteTransitionProps) {
  const [announcement, setAnnouncement] = useState("");
  // The entry flourish opens on `opacity: 0` and a 6px drop, so a page stuck on
  // its first frame is an invisible page sitting 6px low — which is what a
  // hidden document gets, because its animation clock never advances. Decide
  // once, during the first render, whether the animation can actually play:
  // synchronously, so the page never paints its settled state and then flashes
  // back to transparent, and pessimistically, so a page that cannot animate
  // just renders correctly. A route that opens hidden simply forgoes the
  // flourish, which is the right trade for something purely decorative.
  const [animate] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");

  useEffect(() => {
    const headings = Array.from(document.querySelectorAll<HTMLElement>(".app-route-ready h1, header h1"));
    const heading = headings.find((candidate) => candidate.textContent?.trim() && candidate.textContent.trim() !== "Artha") ?? headings[0];
    const label = heading?.textContent?.trim();
    document.title = label ? `${label} · Artha` : "Artha";
    setAnnouncement(label ? `${label} page loaded` : "Page loaded");
  }, [routeKey]);

  return (
    <div className={`app-route-ready min-w-0${animate ? " app-route-animate" : ""}`} data-route={routeKey}>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      {children}
    </div>
  );
}
