export function plainHardwareError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (/paper|offline|not connected|not found|openprinter|writeprinter|timeout|timed out|refused|reset|broken pipe|disconnect|host unreachable|econn/.test(message)) {
    return "Printer is off, disconnected, or out of paper. Check it and retry the same receipt.";
  }
  if (/not configured|required/.test(message)) return "Choose a printer in Hardware Bridge Setup first.";
  return "The receipt could not be printed. Check the printer and retry the same receipt.";
}
