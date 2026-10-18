import type { VoiceIntent } from "./voice-types";

/** Exact navigation phrases only: never turn a mutation, negation, or two
 * different destinations into an accidental navigation. Speech providers can
 * write English commands in Devanagari and repeat the same short phrase. */
export function parseSpokenNavigation(command: string): VoiceIntent | null {
  const text = command.normalize("NFKC").toLowerCase().replace(/[।.,!?]/g, " ").replace(/\s+/g, " ").trim();
  const aliases: [string, string, string][] = [
    ["/billing", "Billing", "billing|bill|बिलिंग|बिलेंग|बिल"],
    ["/products", "Products", "products?|प्रोडक्ट्स?|प्रोडक्ट|उत्पाद"],
    ["/dashboard", "Dashboard", "dashboard|home|डैशबोर्ड|होम"],
    ["/inventory", "Inventory", "inventory|stock|इन्वेंटरी|स्टॉक"],
    ["/customers", "Customers", "customers?|कस्टमर्स?|ग्राहक"],
    ["/reports", "Reports", "reports?|रिपोर्ट्स?|रिपोर्ट"],
  ];
  for (const [route, label, words] of aliases) {
    const phrase = `(?:(?:please|प्लीज|कृपया)\\s+)?(?:(?:open|ओपन|खोलो|खोलें)\\s+)?(?:${words})(?:\\s+(?:page|पेज))?(?:\\s+(?:खोलो|खोलें|दिखाओ|दिखाइए))?`;
    if (new RegExp(`^(?:${phrase})(?:\\s+(?:${phrase}))*$`, "u").test(text)) {
      return { action: "navigate", route, message: `Opening ${label}.`, auditable: true };
    }
  }
  return null;
}

