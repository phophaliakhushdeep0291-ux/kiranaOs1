export function plainHardwareError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (/different receipt payload|different copy count|already active/.test(message)) {
    return "This retry does not match the original print job. Inspect the printer, then start a new print job.";
  }
  if (/predates payload verification/.test(message)) {
    return "This print job is from an older bridge version. Inspect the printer before starting it as a new job.";
  }
  if (/too many unfinished print jobs/.test(message)) {
    return "Printing is paused because too many jobs are unfinished. Resolve the printer and retry the pending receipts.";
  }
  if (/paper|offline|not connected|not found|openprinter|writeprinter|timeout|timed out|refused|reset|broken pipe|disconnect|host unreachable|econn/.test(message)) {
    return "Printer is off, disconnected, or out of paper. Check it and retry the same receipt.";
  }
  if (/not configured|required/.test(message)) return "Choose a printer in Hardware Bridge Setup first.";
  return "The receipt could not be printed. Check the printer and retry the same receipt.";
}
