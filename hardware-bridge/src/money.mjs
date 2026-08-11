/**
 * Money crosses this process as integer paise and is only ever rendered at the
 * very edge, so a display and a printed slip can never disagree about an amount.
 */
export function formatInrFromPaise(totalPaise) {
  const rupees = Math.floor(totalPaise / 100);
  const paise = String(totalPaise % 100).padStart(2, "0");
  return `INR ${rupees}.${paise}`;
}
