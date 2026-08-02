import { useEffect, useRef } from "react";
import { recordRouteBreadcrumb } from "@/lib/diagnostics/telemetryBuffer";
import { ACTIVITY_EVENTS } from "./events";
import { trackEvent } from "./activityClient";

/**
 * useScreenTracking — one SCREEN_VIEW per navigation, carrying how long the user
 * actually stayed.
 *
 * The event is emitted on *leaving* a screen rather than on arriving, because
 * the dwell time is the interesting part: "frequently visited pages" and the
 * dashboard's usage-based widget order both need to distinguish a screen someone
 * works in from one they pass through on the way somewhere else.
 *
 * Route params are stripped. `/customers/cus_abc123` and `/bills/bill_xyz` would
 * otherwise create one counter per record and turn the page ranking into noise —
 * and put record ids into telemetry for no benefit.
 */

export function normalizeScreenPath(path: string): string {
  return (
    path
      .split("?")[0]
      .split("#")[0]
      .split("/")
      .map((segment) => {
        if (!segment) return segment;
        // cuid / uuid / long opaque id / pure number
        if (/^c[a-z0-9]{20,}$/i.test(segment)) return ":id";
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment)) return ":id";
        if (/^\d+$/.test(segment)) return ":id";
        if (/^[A-Za-z0-9_-]{18,}$/.test(segment)) return ":id";
        return segment;
      })
      .join("/") || "/"
  );
}

export function useScreenTracking(location: string, enabled = true): void {
  const previous = useRef<{ screen: string; enteredAt: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const screen = normalizeScreenPath(location);
    recordRouteBreadcrumb(location);

    const prior = previous.current;
    if (prior && prior.screen !== screen) {
      trackEvent(ACTIVITY_EVENTS.SCREEN_VIEW, {}, { screen: prior.screen, durationMs: Date.now() - prior.enteredAt });
    }
    if (!prior || prior.screen !== screen) {
      previous.current = { screen, enteredAt: Date.now() };
    }
  }, [location, enabled]);

  // The last screen of a session never gets a "left it" transition, so close it
  // out when the app is being put away.
  useEffect(() => {
    if (!enabled) return;
    const flushCurrent = () => {
      const current = previous.current;
      if (!current) return;
      trackEvent(ACTIVITY_EVENTS.SCREEN_VIEW, {}, { screen: current.screen, durationMs: Date.now() - current.enteredAt });
      previous.current = { screen: current.screen, enteredAt: Date.now() };
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushCurrent();
    };
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushCurrent);
    return () => {
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushCurrent);
    };
  }, [enabled]);
}
