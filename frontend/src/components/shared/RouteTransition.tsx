import { useEffect, type ReactNode } from "react";

interface RouteTransitionProps {
  children: ReactNode;
  routeKey: string;
}

export function RouteTransition({ children, routeKey }: RouteTransitionProps) {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const headings = Array.from(document.querySelectorAll<HTMLElement>(".app-route-ready h1, header h1"));
      const heading = headings.find((candidate) => candidate.textContent?.trim() && candidate.textContent.trim() !== "KiranaOS") ?? headings[0];
      const label = heading?.textContent?.trim();
      document.title = label ? `${label} · KiranaOS` : "KiranaOS";
    });
    return () => window.cancelAnimationFrame(frame);
  }, [routeKey]);

  return (
    <div className="app-route-ready min-w-0" data-route={routeKey}>
      {children}
    </div>
  );
}
