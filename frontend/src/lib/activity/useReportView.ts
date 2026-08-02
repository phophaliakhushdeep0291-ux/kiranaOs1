import { useEffect, useRef } from "react";
import { ACTIVITY_EVENTS } from "./events";
import { trackEvent } from "./activityClient";

/**
 * useReportView — record that the user opened a report, once per mount.
 *
 * Reports are a named, closed set, unlike screens, so they get their own counter
 * rather than being inferred from the URL: "which reports do I access most
 * frequently?" should say "GST report", not "/reports?tab=3".
 *
 * The mount guard matters because a range change re-renders these pages
 * constantly, and counting each render would make whichever report has the most
 * filters look like the most-used one.
 */
export function useReportView(report: string, label?: string, enabled = true): void {
  const tracked = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || tracked.current === report) return;
    tracked.current = report;
    trackEvent(ACTIVITY_EVENTS.REPORT_VIEW, { report, reportLabel: label ?? report });
  }, [report, label, enabled]);
}
