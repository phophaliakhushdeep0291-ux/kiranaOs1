// Hindi half of the money-check dictionary. Own module so the shell ships only
// the English catalogue and this table is fetched on demand.
//
// Register: counter Hindi, not textbook Hindi. गल्ला, स्टॉक, बिल, खाता, खर्चा,
// UPI stay as the shop says them. The old page title वित्तीय आश्वासन is gone —
// it is a correct translation of a phrase no shopkeeper has ever spoken.
import type { assuranceEn } from "./assurance";

export const assuranceHi: Record<keyof typeof assuranceEn, string> = {
  "assurance.title": "पैसे की जाँच",
  "assurance.subtitle": "बिल, खाता, स्टॉक, खरीद और गल्ला — सबको आपस में मिलाकर देखता है",
  "assurance.run": "अभी जाँचें",
  "assurance.running": "जाँच हो रही है…",
  "assurance.runDone": "जाँच पूरी हुई",
  "assurance.runDoneDetail": "{count} एंट्री जाँची · {created} नई गड़बड़ मिली",

  "assurance.stat.toCheck": "जाँचने लायक रकम",
  "assurance.stat.toCheckHint": "नुकसान पक्का नहीं — इतने पैसे देखने हैं",
  "assurance.stat.problems": "खुली गड़बड़",
  "assurance.stat.problemsHint": "अभी कुछ तय नहीं हुआ",
  "assurance.stat.urgent": "पहले देखें",
  "assurance.stat.urgentHint": "सबसे बड़ा फ़र्क़, सबसे पुराना पहले",
  "assurance.stat.proof": "सबूत बाकी",
  "assurance.stat.proofHint": "बिल या फ़ोटो लगाना बाकी है",

  "assurance.empty.title": "कुछ जाँचने को नहीं",
  "assurance.empty.hint": "आपके बिल, स्टॉक और गल्ला आपस में मिल रहे हैं।",
  "assurance.lastChecked": "पिछली जाँच {when}",
  "assurance.neverChecked": "अभी तक जाँच नहीं हुई",

  "assurance.action.fine": "यह ठीक है",
  "assurance.action.problem": "यह गलत है",
  "assurance.action.later": "बाद में देखें",
  "assurance.whyFlagged": "यह क्यों आया?",
  "assurance.whatToDo": "क्या करें",
  "assurance.auditorView": "ऑडिटर वाली जानकारी",
  "assurance.auditorViewHint": "रूल कोड, वेट और स्कोर — अपने CA के लिए",
  "assurance.reference": "हवाला",
  "assurance.item": "यह सामान",

  "assurance.rule.CLOSING_CASH_FIGURE_STALE.head": "गल्ले में {amount} कम है",
  "assurance.rule.CLOSING_CASH_FIGURE_STALE.body":
    "बिल और खाता वसूली से नकद {expected} बनता है, पर उस दिन की क्लोज़िंग में {recorded} लिखा है।",
  "assurance.rule.CLOSING_CASH_FIGURE_STALE.do":
    "उस दिन की क्लोज़िंग दोबारा बनाएँ। लॉक है तो खोलें, ताज़ा करें, फिर लॉक करें।",
  "assurance.rule.CLOSING_CASH_FIGURE_STALE.over": "गल्ले में बिल से {amount} ज़्यादा है",

  "assurance.rule.CLOSING_CASH_EXPENSES_NOT_DEDUCTED.head": "{amount} नकद का हिसाब नहीं मिल रहा",
  "assurance.rule.CLOSING_CASH_EXPENSES_NOT_DEDUCTED.body":
    "नकद बिक्री, खाता वसूली, सप्लायर को दिया और नकद खर्चा जोड़ने पर गल्ले में {expected} होना चाहिए — क्लोज़िंग में {recorded} है।",
  "assurance.rule.CLOSING_CASH_EXPENSES_NOT_DEDUCTED.do":
    "देखें कि उस दिन कोई नकद खर्चा या सप्लायर पेमेंट लिखना छूट तो नहीं गया।",

  "assurance.rule.CLOSING_UPI_FIGURE_STALE.head": "UPI का जोड़ {amount} से अलग है",
  "assurance.rule.CLOSING_UPI_FIGURE_STALE.body":
    "बिलों पर UPI {expected} बनता है, पर उस दिन की क्लोज़िंग में {recorded} लिखा है।",
  "assurance.rule.CLOSING_UPI_FIGURE_STALE.do": "UPI ऐप की स्टेटमेंट से दिन मिलाएँ, फिर क्लोज़िंग दोबारा बनाएँ।",

  "assurance.rule.STOCK_NEGATIVE_BALANCE.head": "{name} का स्टॉक माइनस में है",
  "assurance.rule.STOCK_NEGATIVE_BALANCE.body":
    "जितना आया उससे {qty} ज़्यादा बिक गया। ज़्यादातर कोई खरीद बिल चढ़ाना छूट जाता है।",
  "assurance.rule.STOCK_NEGATIVE_BALANCE.do": "छूटा हुआ खरीद बिल चढ़ाएँ, या माल गिनकर स्टॉक सही करें।",

  "assurance.rule.STOCK_DECREASE_WITHOUT_SOURCE.head": "{name} का {qty} बिना बिल के निकला",
  "assurance.rule.STOCK_DECREASE_WITHOUT_SOURCE.body1":
    "एक बार स्टॉक कम हुआ, पर उसके पीछे न बिक्री थी, न टूट-फूट, न ट्रांसफ़र, न कोई सुधार।",
  "assurance.rule.STOCK_DECREASE_WITHOUT_SOURCE.body":
    "{count} बार स्टॉक कम हुआ, पर उसके पीछे न बिक्री थी, न टूट-फूट, न ट्रांसफ़र, न कोई सुधार।",
  "assurance.rule.STOCK_DECREASE_WITHOUT_SOURCE.do":
    "पूछें कि माल कहाँ गया। बिना वजह स्टॉक घटना लीकेज का सबसे साफ़ इशारा है।",

  "assurance.rule.STOCK_INCREASE_WITHOUT_SOURCE.head": "{name} का स्टॉक बिना खरीद बिल के बढ़ा",
  "assurance.rule.STOCK_INCREASE_WITHOUT_SOURCE.body1":
    "एक बार माल जुड़ा, पर न खरीद थी, न वापसी, न कोई लिखा हुआ सुधार।",
  "assurance.rule.STOCK_INCREASE_WITHOUT_SOURCE.body":
    "{count} बार माल जुड़ा, पर न खरीद थी, न वापसी, न कोई लिखा हुआ सुधार।",
  "assurance.rule.STOCK_INCREASE_WITHOUT_SOURCE.do": "जो माल आया उसका खरीद बिल या गुड्स-रिसीट लगाएँ।",

  "assurance.rule.STOCK_SALE_EXCEEDED_AVAILABLE.head": "{name} स्टॉक से ज़्यादा बिक गया",
  "assurance.rule.STOCK_SALE_EXCEEDED_AVAILABLE.body1":
    "एक बिक्री ने इस माल को ज़ीरो से नीचे कर दिया — बेचने को स्टॉक था ही नहीं।",
  "assurance.rule.STOCK_SALE_EXCEEDED_AVAILABLE.body":
    "{count} बिक्री ने इस माल को ज़ीरो से नीचे कर दिया — बेचने को स्टॉक था ही नहीं।",
  "assurance.rule.STOCK_SALE_EXCEEDED_AVAILABLE.do": "छूटी हुई खरीद चढ़ाएँ, या माल गिनकर सुधार डालें।",

  "assurance.rule.generic.body": "आपकी अपनी एंट्रियों से अपने आप जाँचा गया।",
};
