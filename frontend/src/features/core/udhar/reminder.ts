import { buildWhatsappMessageUrl } from "@/features/core/bills/share";
import { formatMoney } from "@/lib/money";

export function buildUdharReminderText(shopName: string, customerName: string, amount: number): string {
  return `नमस्ते ${customerName} जी 🙏\n${shopName} में आपका उधार ${formatMoney(amount)} बाकी है। कृपया सुविधानुसार भुगतान कर दें।\nधन्यवाद।`;
}

export function buildUdharReminderUrl(shopName: string, customerName: string, mobile: string | null | undefined, amount: number): string {
  return buildWhatsappMessageUrl(mobile ?? undefined, buildUdharReminderText(shopName, customerName, amount));
}
