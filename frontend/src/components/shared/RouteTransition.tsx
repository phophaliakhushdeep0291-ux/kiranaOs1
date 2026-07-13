import { useEffect, type ReactNode } from "react";

interface RouteTransitionProps {
  children: ReactNode;
  routeKey: string;
}

export function RouteTransition({ children, routeKey }: RouteTransitionProps) {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>("#main-content h1, .app-route-ready h1");
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
