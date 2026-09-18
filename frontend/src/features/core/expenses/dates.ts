import { format, parseISO } from "date-fns";

// A date picker represents the device's calendar day, not a UTC day.
export function expenseDateInput(value?: string | null, now = new Date()): string {
  return format(value ? parseISO(value) : now, "yyyy-MM-dd");
}

export function expenseDateTimestamp(value: string): string {
  return parseISO(value).toISOString();
}
