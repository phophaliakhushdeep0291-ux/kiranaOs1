// Reviewed app guidance. The model selects a topic; it cannot supply instructions
// or turn help text into a claim about this shop's records or enabled features.
export const BUSINESS_HELP = Object.freeze({
  billing: {
    en: "Open Billing (/billing), add the products and quantities, review the totals, then choose the payment method and confirm. A chat proposal does not finish a sale; review its confirmation first.",
    hi: "Billing (/billing) खोलें, सामान और मात्रा जोड़ें, कुल रकम जाँचें और भुगतान का तरीका चुनकर पुष्टि करें। चैट में तैयार बदलाव से बिक्री पूरी नहीं होती; पहले उसकी पुष्टि देखें।",
  },
  products: {
    en: "Open Products (/products) to find an item and review its selling price, unit and stock settings. Match the exact product and pack before changing a rate. Changes depend on your account permissions.",
    hi: "Products (/products) में सामान खोजकर उसका रेट, यूनिट और स्टॉक सेटिंग देखें। रेट बदलने से पहले सही सामान और पैक मिलाएँ। बदलाव आपके खाते की अनुमति पर निर्भर हैं।",
  },
  inventory: {
    en: "Use Inventory (/inventory) to review stock. Record incoming goods in Stock in (/inventory/stock-in); use Stock counts (/inventory/stock-counts) for a physical count. Check the unit and pack before entering a quantity; an adjustment needs review.",
    hi: "Inventory (/inventory) में स्टॉक देखें। आया हुआ माल Stock in (/inventory/stock-in) में दर्ज करें; गिनती के लिए Stock counts (/inventory/stock-counts) खोलें। मात्रा भरने से पहले यूनिट और पैक जाँचें; समायोजन देखकर करें।",
  },
  credit: {
    en: "Open Customers (/customers), select the correct customer and review their account. Use Udhar (/udhar) to review outstanding credit. A payment entry records money received; it does not collect or transfer money by itself.",
    hi: "Customers (/customers) में सही ग्राहक चुनकर खाता देखें। बकाया देखने के लिए Udhar (/udhar) खोलें। भुगतान की एंट्री मिली हुई रकम दर्ज करती है; इससे पैसा अपने आप वसूल या ट्रांसफर नहीं होता।",
  },
  returns: {
    en: "Open Returns (/returns), locate the original sale and check the item, returned quantity and refund method before confirming. A recorded refund and a transfer by your payment provider are separate; verify the actual payment status.",
    hi: "Returns (/returns) में मूल बिक्री खोजें और पुष्टि से पहले सामान, वापसी की मात्रा और रिफंड का तरीका जाँचें। रिफंड की एंट्री और भुगतान प्रदाता से पैसा वापस जाना अलग हैं; वास्तविक भुगतान स्थिति जाँचें।",
  },
  reports: {
    en: "Open Reports (/reports) and choose the date range. You can ask this assistant for sales, gross profit, top products, stock health, daily closing or outstanding credit. Include the period and product/customer name when relevant. Profit and other restricted information require the appropriate role.",
    hi: "Reports (/reports) में तारीख की सीमा चुनें। सहायक से बिक्री, सकल लाभ, सबसे अधिक बिके सामान, स्टॉक, दिन के बंद का हिसाब या बकाया पूछ सकते हैं। जरूरत पर अवधि और सामान/ग्राहक का नाम दें। लाभ जैसी सीमित जानकारी के लिए सही भूमिका चाहिए।",
  },
  offline: {
    en: "Core counter work saves on the device first. Open Sync status (/sync-status) to check pending, failed or conflicting changes and reconnect to sync. A local save is not proof the server accepted it. Do not clear browser storage or reset the device while changes are pending. Online AI and payment-provider operations require connectivity.",
    hi: "काउंटर का मुख्य काम पहले डिवाइस पर सेव होता है। Sync status (/sync-status) में लंबित, असफल या टकराव वाले बदलाव देखें और इंटरनेट आने पर सिंक करें। लोकल सेव का मतलब सर्वर की स्वीकृति नहीं है। बदलाव लंबित हों तो ब्राउज़र स्टोरेज साफ या डिवाइस रीसेट न करें। ऑनलाइन AI और भुगतान प्रदाता के काम के लिए इंटरनेट चाहिए।",
  },
  tally: {
    en: "Open Settings → Integrations (/settings/integrations) and review the Tally connection and ledger mappings. Check the company and mappings before export, then reconcile the imported vouchers in Tally. Ask an owner if this option is unavailable. Chat cannot confirm that an export or Tally import succeeded without its actual result.",
    hi: "Settings → Integrations (/settings/integrations) में Tally कनेक्शन और लेजर मैपिंग देखें। एक्सपोर्ट से पहले कंपनी और मैपिंग जाँचें, फिर Tally में आए वाउचर मिलाएँ। विकल्प न दिखे तो मालिक से पूछें। वास्तविक परिणाम के बिना चैट एक्सपोर्ट या Tally इम्पोर्ट की सफलता की पुष्टि नहीं कर सकती।",
  },
  payments: {
    en: "Choose the actual payment method when settling a bill. Cash and recorded external payments need staff to verify receipt. Recording a card or bank payment is not proof a provider charged it. Review the bill (/bills) and provider receipt before retrying or refunding.",
    hi: "बिल चुकाते समय वास्तविक भुगतान का तरीका चुनें। नकद और बाहर मिले भुगतान की प्राप्ति कर्मचारी को जाँचनी होती है। कार्ड या बैंक भुगतान दर्ज होना प्रदाता द्वारा पैसा काटने का प्रमाण नहीं है। दोबारा प्रयास या रिफंड से पहले बिल (/bills) और भुगतान रसीद देखें।",
  },
  stock_planning: {
    en: "For a reorder decision, check recent sales, current stock, pack sizes, incoming purchases and the supplier's lead time. A best-seller alone is not proof that stock is low. A negative stock figure means recorded sales/stock-outs exceeded recorded stock; check missing receipts, counts and sync conflicts before making an adjustment. I need the product and period to inspect the relevant records.",
    hi: "माल मंगाने से पहले हाल की बिक्री, मौजूदा स्टॉक, पैक, आने वाली खरीद और सप्लायर का समय देखें। ज्यादा बिकने का मतलब हमेशा कम स्टॉक नहीं होता। नेगेटिव स्टॉक का मतलब दर्ज बिक्री/निकासी, दर्ज स्टॉक से ज्यादा है; बदलाव से पहले छूटी हुई प्राप्ति, गिनती और सिंक टकराव जाँचें। रिकॉर्ड देखने के लिए सामान और अवधि चाहिए।",
  },
  profit: {
    en: "Sales, profit and cash collected are different. Gross profit compares sales with the recorded cost of goods; it does not by itself show net profit after rent, salaries and other expenses. Credit sales can increase sales before cash is collected. Missing costs, returns and unsynced transactions can affect comparisons. Give the period to inspect the available report; I cannot confirm a cause or net profit without the relevant records.",
    hi: "बिक्री, लाभ और मिली नकदी अलग हैं। सकल लाभ बिक्री और सामान की दर्ज लागत का फर्क है; इससे किराया, वेतन और अन्य खर्चों के बाद शुद्ध लाभ अपने आप नहीं मिलता। उधार बिक्री में नकदी बाद में मिल सकती है। छूटी लागत, वापसी और असिंक लेनदेन तुलना को प्रभावित कर सकते हैं। उपलब्ध रिपोर्ट देखने के लिए अवधि बताएं; संबंधित रिकॉर्ड के बिना कारण या शुद्ध लाभ की पुष्टि नहीं कर सकता।",
  },
  sales_improvement: {
    en: "Start by comparing the same sales periods, best-selling products and stock shortages. Check whether popular items were unavailable before deciding on promotions. Review margins and costs before discounting; higher sales do not necessarily mean higher profit. These are investigation steps, not a finding about your shop or a guaranteed result. Share the period and products so I can check the available records.",
    hi: "समान अवधियों की बिक्री, सबसे अधिक बिके सामान और स्टॉक की कमी की तुलना से शुरू करें। प्रचार तय करने से पहले देखें कि लोकप्रिय सामान उपलब्ध था या नहीं। छूट से पहले मार्जिन और लागत देखें; ज्यादा बिक्री हमेशा ज्यादा लाभ नहीं है। ये जाँच के कदम हैं, आपकी दुकान का निष्कर्ष या परिणाम की गारंटी नहीं। रिकॉर्ड देखने के लिए अवधि और सामान बताएं।",
  },
  capabilities: {
    en: "Ask in natural English, Hindi or Hinglish about products, stock, sales, customer credit or using the app. You can ask several questions together and follow up with more detail. I can read only your shop's permitted records; changes require confirmation. If data or a connection is missing, I need that information rather than guessing.",
    hi: "सामान, स्टॉक, बिक्री, ग्राहक के बकाया या ऐप चलाने के बारे में सामान्य अंग्रेज़ी, हिंदी या Hinglish में पूछें। एक साथ कई सवाल और फिर उनके बारे में आगे पूछ सकते हैं। मैं आपकी दुकान के अनुमत रिकॉर्ड ही पढ़ सकता हूँ; बदलाव के लिए पुष्टि चाहिए। जानकारी या कनेक्शन न हो तो अनुमान लगाने के बजाय उसकी जरूरत बताऊँगा।",
  },
});

export const CLARIFICATIONS = Object.freeze({
  product: { en: "Which product and pack do you mean? Please give its name or barcode.", hi: "कौन सा सामान और पैक चाहिए? उसका नाम या बारकोड बताएं।" },
  customer: { en: "Which customer do you mean? Please give their name or phone number.", hi: "कौन सा ग्राहक है? उसका नाम या फोन नंबर बताएं।" },
  date_range: { en: "Which period should I check: today, this month, or specific start and end dates?", hi: "किस अवधि का हिसाब देखूँ: आज, इस महीने का, या शुरू और खत्म की तारीखें?" },
  quantity: { en: "What quantity and unit do you mean? Please include the pack size if relevant.", hi: "कितनी मात्रा और कौन सी यूनिट है? जरूरत हो तो पैक का आकार भी बताएं।" },
  amount: { en: "What amount do you mean, and for which bill or customer?", hi: "कितनी रकम है और किस बिल या ग्राहक के लिए?" },
  payment_method: { en: "Which payment method was used, and has the money actually been received?", hi: "भुगतान किस तरीके से हुआ और क्या रकम वास्तव में मिल गई है?" },
  choice: { en: "More than one record could match. Which of the listed products or customers do you mean?", hi: "एक से ज्यादा रिकॉर्ड मिल रहे हैं। दिखाए गए किस सामान या ग्राहक की बात कर रहे हैं?" },
  topic: { en: "What would you like to check or do in your shop? Include the item, customer or period if relevant.", hi: "दुकान में क्या देखना या करना चाहते हैं? जरूरत के अनुसार सामान, ग्राहक या अवधि बताएं।" },
});

export function renderBusinessHelp(result, language = "hi") {
  const copy = language === "en" ? "en" : "hi";
  return [...new Set(Array.isArray(result?.topics) ? result.topics : [])].slice(0, 3)
    .map((topic) => Object.hasOwn(BUSINESS_HELP, topic) ? BUSINESS_HELP[topic][copy] : null).filter(Boolean).join("\n\n") || null;
}

export function renderClarification(result, language = "hi") {
  return typeof result?.field === "string" && Object.hasOwn(CLARIFICATIONS, result.field)
    ? CLARIFICATIONS[result.field][language === "en" ? "en" : "hi"] : null;
}
