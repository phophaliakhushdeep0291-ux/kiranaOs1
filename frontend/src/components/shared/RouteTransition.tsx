import { useEffect, useState, type ReactNode } from "react";

interface RouteTransitionProps {
  children: ReactNode;
  routeKey: string;
}

export function RouteTransition({ children, routeKey }: RouteTransitionProps) {
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const headings = Array.from(document.querySelectorAll<HTMLElement>(".app-route-ready h1, header h1"));
    const heading = headings.find((candidate) => candidate.textContent?.trim() && candidate.textContent.trim() !== "Artha") ?? headings[0];
    const label = heading?.textContent?.trim();
    document.title = label ? `${label} · Artha` : "Artha";
    setAnnouncement(label ? `${label} page loaded` : "Page loaded");
  }, [routeKey]);

  return (
    <div className="app-route-ready min-w-0" data-route={routeKey}>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      {children}
    </div>
  );
}
