// Hindi half of the assistant dictionary.
//
// Written the way a shopkeeper actually speaks rather than in formal Hindi:
// "udhar" and "stock" stay as they are said at a counter, because translating
// them into shuddh Hindi would make the panel harder to read, not easier.
import type { assistantEn } from "./assistant";

export const assistantHi: Record<keyof typeof assistantEn, string> = {
  "assistant.title": "सहायक",
  "assistant.subtitle": "दुकान के बारे में पूछें, या बदलाव बताएं",
  "assistant.open": "सहायक खोलें",
  "assistant.close": "बंद करें",
  "assistant.inputPlaceholder": "दुकान के बारे में कुछ भी पूछें…",
  "assistant.send": "भेजें",
  "assistant.thinking": "देख रहे हैं…",
  "assistant.clear": "फिर से शुरू करें",
  "assistant.speak": "बोलें",
  "assistant.listening": "सुन रहे हैं… रोकने के लिए दबाएँ",
  "assistant.transcribing": "आपकी बात लिखी जा रही है…",
  "assistant.micDenied": "माइक की अनुमति नहीं मिली। टाइप करके बताएँ।",

  "assistant.emptyTitle": "क्या जानना चाहते हैं?",
  "assistant.emptyBody": "यह आपका स्टॉक, बिक्री, ग्राहक और उधार पढ़ सकता है, और बदलाव तैयार करके आपसे पुष्टि माँगता है।",
  "assistant.example.sales": "इस हफ़्ते कितनी बिक्री हुई?",
  "assistant.example.lowStock": "क्या ख़त्म होने वाला है?",
  "assistant.example.udhar": "सबसे ज़्यादा उधार किसका है?",
  "assistant.example.price": "चीनी का रेट 45 कर दो",

  "assistant.planTitle": "आपकी पुष्टि का इंतज़ार",
  "assistant.planNote": "अभी कुछ नहीं बदला है।",
  "assistant.confirm": "पुष्टि करें",
  "assistant.reject": "रद्द करें",
  "assistant.confirming": "लागू कर रहे हैं…",
  "assistant.confirmed": "हो गया",
  "assistant.rejected": "रद्द कर दिया",
  "assistant.partialFailure": "कुछ बदलाव लागू नहीं हो सके",
  "assistant.openBill": "बिल खोलें ({count} चीज़ें जोड़ी गईं)",
  "assistant.till.title": "सहायक",
  "assistant.till.thinking": "देख रहे हैं…",
  "assistant.till.apply": "इस बिल में जोड़ें",
  "assistant.till.dismiss": "हटाएँ",
  "assistant.till.applied": "बिल में जोड़ दिया",
  "assistant.till.nothingToAdd": "इसमें जोड़ने लायक कुछ नहीं मिला।",

  "assistant.ownerPinTitle": "मालिक का PIN चाहिए",
  "assistant.ownerPinBody": "इसमें रेट या स्टॉक बदल रहा है, इसलिए मालिक का 4 अंकों का PIN ज़रूरी है।",
  "assistant.ownerPinPlaceholder": "4 अंकों का PIN",
  "assistant.ownerPinSubmit": "PIN से पुष्टि करें",
  "assistant.ownerPinWrong": "यह PIN स्वीकार नहीं हुआ",

  "assistant.sourcesTitle": "इसने क्या देखा",
  "assistant.sourcesToggle": "देखें इसने क्या पढ़ा",
  "assistant.sourcesHide": "छिपाएँ",

  "assistant.offline": "सहायक के लिए इंटरनेट चाहिए। वॉइस कमांड ऑफ़लाइन भी चलते हैं।",
  "assistant.unavailable": "इस सर्वर पर सहायक सेट नहीं है।",
  "assistant.busy": "सहायक व्यस्त है। थोड़ी देर में फिर कोशिश करें।",
  "assistant.failed": "यह काम नहीं हुआ। दूसरे शब्दों में कहें।",
  "assistant.feedback.question": "क्या यह सही था?",
  "assistant.feedback.correct": "सही",
  "assistant.feedback.misunderstood": "गलत समझा",
  "assistant.feedback.unsafe": "असुरक्षित",
  "assistant.feedback.thanks": "राय दर्ज हो गई — संदेश या ग्राहक की जानकारी कॉपी नहीं हुई।",
  "assistant.feedback.failed": "राय सेव नहीं हुई। फिर कोशिश करें।",
};
