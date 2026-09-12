// Hindi half of the accounting dictionary. Its own module so the shell ships
// only the English catalogue and this table is fetched when the screen is opened.
//
// The typed Record below is the guarantee: a key added to accounting.ts and
// forgotten here fails typecheck rather than shipping an English string to a
// Hindi-speaking owner.
import type { accountingEn } from "./accounting";

export const accountingHi: Record<keyof typeof accountingEn, string> = {
  // ── पेज ──
  "accounting.title": "लेखा-जोखा",
  "accounting.subtitle": "चढ़ा हुआ बही-खाता — जो किताबों में लिखा है, वो; काउंटर का अंदाज़ा नहीं।",
  "accounting.ownerOnly": "दुकान की किताबें सिर्फ मालिक खोल सकता है।",
  "accounting.loadFailed": "किताबें नहीं खुल पाईं। सर्वर से जुड़कर फिर देखें — यहां ऑफलाइन अंदाज़ा नहीं दिखाया जाता, क्योंकि अंदाज़ा बही-खाता नहीं होता।",
  "accounting.loading": "बही-खाता पढ़ा जा रहा है…",
  "accounting.retry": "फिर कोशिश करें",

  // ── टैब ──
  "accounting.tab.trialBalance": "ट्रायल बैलेंस",
  "accounting.tab.profitAndLoss": "लाभ-हानि",
  "accounting.tab.balanceSheet": "बैलेंस शीट",
  "accounting.tab.chartOfAccounts": "खातों की सूची",
  "accounting.tab.periods": "लेखा अवधि",

  // ── अवधि ──
  "accounting.range.from": "से",
  "accounting.range.to": "तक",
  "accounting.range.asOf": "इस तारीख तक",

  // ── स्थिति ──
  "accounting.status.balanced": "बराबर है",
  "accounting.status.attention": "देखने की ज़रूरत है",
  "accounting.status.balancedHint": "हर चढ़े हुए खाते में डेबिट और क्रेडिट बराबर हैं।",
  "accounting.status.attentionHint": "डेबिट और क्रेडिट बराबर नहीं हैं। फर्क नीचे दिया है।",

  // ── कॉलम ──
  "accounting.col.code": "कोड",
  "accounting.col.account": "खाता",
  "accounting.col.category": "किस्म",
  "accounting.col.debit": "डेबिट",
  "accounting.col.credit": "क्रेडिट",
  "accounting.col.balance": "बाकी",
  "accounting.col.amount": "रकम",
  "accounting.col.status": "स्थिति",

  // ── जोड़ ──
  "accounting.total.debit": "कुल डेबिट",
  "accounting.total.credit": "कुल क्रेडिट",
  "accounting.total.difference": "फर्क",

  // ── खाते की किस्म ──
  "accounting.category.asset": "संपत्ति",
  "accounting.category.liability": "देनदारी",
  "accounting.category.equity": "पूंजी",
  "accounting.category.income": "आय",
  "accounting.category.expense": "खर्च",

  // ── लाभ-हानि ──
  "accounting.pnl.income": "आय",
  "accounting.pnl.expenses": "खर्च",
  "accounting.pnl.totalIncome": "कुल आय",
  "accounting.pnl.totalExpenses": "कुल खर्च",
  "accounting.pnl.netProfit": "शुद्ध लाभ",
  "accounting.pnl.netLoss": "शुद्ध हानि",
  "accounting.pnl.basisTitle": "यह बही-खाते का लाभ-हानि है",
  "accounting.pnl.basisBody": "यह चढ़ी हुई जर्नल लाइनों से बनता है। रिपोर्ट वाला मुनाफा सीधे बिलों से पढ़ा गया अंदाज़ा है, इसलिए दोनों आंकड़े अलग हो सकते हैं — किताबों में यही सही माना जाएगा।",

  // ── बैलेंस शीट ──
  "accounting.bs.assets": "संपत्ति",
  "accounting.bs.liabilities": "देनदारी",
  "accounting.bs.equity": "पूंजी",
  "accounting.bs.totalAssets": "कुल संपत्ति",
  "accounting.bs.totalLiabilities": "कुल देनदारी",
  "accounting.bs.totalEquity": "कुल पूंजी",

  // ── खातों की सूची ──
  "accounting.coa.loadTitle": "खातों की सूची खोलें",
  "accounting.coa.loadBody": "इसे खोलने पर छूटे हुए सिस्टम खाते भी बन जाते हैं और वह ऑडिट लॉग में दर्ज होता है, इसलिए मांगे बिना यह अपने आप नहीं खुलती।",
  "accounting.coa.loadAction": "खातों की सूची खोलें",
  "accounting.coa.systemBadge": "सिस्टम",
  "accounting.coa.inactiveBadge": "बंद",
  "accounting.coa.empty": "अभी कोई खाता नहीं है।",

  // ── लेखा अवधि ──
  "accounting.period.name": "अवधि",
  "accounting.period.starts": "शुरू",
  "accounting.period.ends": "खत्म",
  "accounting.period.open": "खुली",
  "accounting.period.closed": "बंद",
  "accounting.period.closedOn": "बंद हुई",
  "accounting.period.reason": "वजह",
  "accounting.period.empty": "अभी कोई लेखा अवधि नहीं बनी। जब तक कोई अवधि बंद नहीं होती, हर तारीख पर एंट्री चढ़ सकती है।",

  // ── खाली ──
  "accounting.empty.title": "इस अवधि में कुछ नहीं चढ़ा",
  "accounting.empty.body": "इन तारीखों के बीच किसी जर्नल लाइन की कारोबारी तारीख नहीं आती।",

  // ── रिपोर्ट स्क्रीन पर जाने का रास्ता ──
  "accounting.entry.body": "ट्रायल बैलेंस, लाभ-हानि, बैलेंस शीट और खातों की सूची — सीधे चढ़े हुए बही-खाते से।",
  "accounting.entry.action": "खोलें",
  // फ़ोन की “और” सूची में एक ही कटी हुई लाइन — छोटा रखें।
  "accounting.entry.menuHelper": "ट्रायल बैलेंस, लाभ-हानि, बैलेंस शीट",

  // ── नीचे ──
  "accounting.note.version": "प्रोजेक्शन",
};
