// Hindi half of the accounting dictionary. Its own module so the shell ships
// only the English catalogue and this table is fetched when the screen is opened.
//
// The typed Record below is the guarantee: a key added to accounting.ts and
// forgotten here fails typecheck rather than shipping an English string to a
// Hindi-speaking owner.
import type { accountingEn } from "./accounting";

export const accountingHi: Record<keyof typeof accountingEn, string> = {
  // ── पेज ──
  "accounting.subtitle": "चढ़े जर्नल, शेष और वित्तीय विवरण।",
  "accounting.ownerOnly": "दुकान की किताबें सिर्फ मालिक खोल सकता है।",
  "accounting.loadFailed": "खाते उपलब्ध नहीं हैं। सर्वर से जुड़कर फिर कोशिश करें।",
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
  "accounting.status.noData": "कोई प्रविष्टि नहीं",
  "accounting.integrity.review": "योगों पर भरोसा करने से पहले खाते जाँचें।",
  "accounting.integrity.checked": "दर्ज स्रोत प्रविष्टियाँ और जर्नल मेल खाते हैं।",
  "accounting.integrity.unposted": "जर्नल में नहीं चढ़ी स्रोत प्रविष्टियाँ",
  "accounting.integrity.mismatch": "स्रोत में अंतर",
  "accounting.integrity.invalid": "समीक्षा के लिए जर्नल",
  "accounting.integrity.action": "योग केवल चढ़ी प्रविष्टियों के हैं। अवधि बंद करने से पहले लेखाकार से प्रविष्टियों का अंतर हल कराएँ।",
  "accounting.integrity.scope": "जाँच दर्ज प्रविष्टियों की है। शुरुआती शेष, स्टॉक मूल्य, कर और बैंक मिलान अलग जाँचें।",
  "accounting.status.balanced": "बराबर है",
  "accounting.status.attention": "देखने की ज़रूरत है",
  "accounting.status.balancedHint": "हर चढ़े हुए खाते में डेबिट और क्रेडिट बराबर हैं।",
  "accounting.status.attentionHint": "नीचे प्रविष्टियों की जाँच और डेबिट/क्रेडिट के अंतर की समीक्षा करें।",

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
  "accounting.pnl.basisTitle": "चढ़े जर्नल से लाभ-हानि",
  "accounting.pnl.basisBody": "ये योग चढ़ी प्रविष्टियों से बनते हैं। रिपोर्ट बिलों का अनुमान दिखाती है, इसलिए अंतर हो सकता है।",

  // ── बैलेंस शीट ──
  "accounting.bs.assets": "संपत्ति",
  "accounting.bs.liabilities": "देनदारी",
  "accounting.bs.equity": "पूंजी",
  "accounting.bs.totalAssets": "कुल संपत्ति",
  "accounting.bs.totalLiabilities": "कुल देनदारी",
  "accounting.bs.totalEquity": "कुल पूंजी",

  // ── खातों की सूची ──
  "accounting.coa.loadTitle": "खातों की सूची खोलें",
  "accounting.coa.loadBody": "खोलने पर छूटे सिस्टम खाते बनेंगे और कार्रवाई ऑडिट लॉग में दर्ज होगी।",
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
  "accounting.period.empty": "अभी कोई अवधि नहीं है। अवधि बंद होने तक तारीखों पर प्रविष्टि हो सकती है।",

  // ── खाली ──
  "accounting.empty.title": "इस अवधि में कुछ नहीं चढ़ा",
  "accounting.empty.body": "इन तारीखों के बीच किसी जर्नल लाइन की कारोबारी तारीख नहीं आती।",

  // ── रिपोर्ट स्क्रीन पर जाने का रास्ता ──
  // फ़ोन की “और” सूची में एक ही कटी हुई लाइन — छोटा रखें।

  // ── नीचे ──
  "accounting.note.version": "प्रोजेक्शन",
};
