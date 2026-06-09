import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AppLanguage = "en" | "hi";

const LANGUAGE_STORAGE_KEY = "kirana-os:ui-language:v1";

type TranslationKey =
  | "app.tagline"
  | "app.taglineHindi"
  | "status.online"
  | "status.syncing"
  | "status.offline"
  | "status.pendingBackup"
  | "status.conflicts"
  | "status.dataSafe"
  | "nav.dashboard"
  | "nav.billing"
  | "nav.bills"
  | "nav.products"
  | "nav.inventory"
  | "nav.customers"
  | "nav.udhar"
  | "nav.reports"
  | "nav.closing"
  | "nav.settings"
  | "nav.suppliers"
  | "nav.staff"
  | "nav.devices"
  | "nav.sync"
  | "nav.smartTools"
  | "nav.recovery"
  | "nav.auditLogs"
  | "nav.recycleBin"
  | "nav.plans"
  | "nav.subscription"
  | "dashboard.title"
  | "dashboard.newBill"
  | "dashboard.localSource"
  | "dashboard.todayRevenue"
  | "dashboard.todayProfit"
  | "dashboard.totalUdhar"
  | "dashboard.cashCollected"
  | "dashboard.payments"
  | "dashboard.udharOutstanding"
  | "dashboard.viewAll"
  | "dashboard.noUdhar"
  | "dashboard.ownerWidgets"
  | "dashboard.openReports"
  | "dashboard.localEstimate"
  | "dashboard.quickActions"
  | "dashboard.sevenDaySales"
  | "dashboard.thirtyDaySales"
  | "dashboard.pendingUdhar"
  | "dashboard.lowStock"
  | "dashboard.pendingSync"
  | "settings.title"
  | "settings.subtitle"
  | "settings.profile"
  | "settings.shop"
  | "settings.language"
  | "settings.advanced"
  | "settings.security"
  | "settings.profileTitle"
  | "settings.languageTitle"
  | "settings.languageHelp"
  | "settings.english"
  | "settings.hindi"
  | "settings.advancedTitle"
  | "settings.advancedHelp";

const translations: Record<AppLanguage, Record<TranslationKey, string>> = {
  en: {
    "app.tagline": "Fast POS",
    "app.taglineHindi": "Fast POS",
    "status.online": "Backend online",
    "status.syncing": "Cloud backup running",
    "status.offline": "Backend offline, billing works",
    "status.pendingBackup": "changes pending backup",
    "status.conflicts": "sync conflicts",
    "status.dataSafe": "Data safe locally",
    "nav.dashboard": "Dashboard",
    "nav.billing": "Billing",
    "nav.bills": "Bills",
    "nav.products": "Products",
    "nav.inventory": "Inventory",
    "nav.customers": "Customers",
    "nav.udhar": "Udhar",
    "nav.reports": "Reports",
    "nav.closing": "Closing",
    "nav.settings": "Settings",
    "nav.suppliers": "Suppliers",
    "nav.staff": "Staff",
    "nav.devices": "Devices",
    "nav.sync": "Sync",
    "nav.smartTools": "Smart Tools",
    "nav.recovery": "Recovery",
    "nav.auditLogs": "Audit Logs",
    "nav.recycleBin": "Recycle Bin",
    "nav.plans": "Plans",
    "nav.subscription": "Subscription",
    "dashboard.title": "Dashboard",
    "dashboard.newBill": "New Bill",
    "dashboard.localSource": "Dashboard loads from local data. Cloud refresh runs in background.",
    "dashboard.todayRevenue": "Today's Revenue",
    "dashboard.todayProfit": "Today's Profit",
    "dashboard.totalUdhar": "Total Udhar",
    "dashboard.cashCollected": "Cash Collected",
    "dashboard.payments": "Today's Payments",
    "dashboard.udharOutstanding": "Udhar Outstanding",
    "dashboard.viewAll": "View all",
    "dashboard.noUdhar": "No outstanding udhar",
    "dashboard.ownerWidgets": "Owner report widgets",
    "dashboard.openReports": "Open reports",
    "dashboard.localEstimate": "Reports are local estimate until pending changes are backed up.",
    "dashboard.quickActions": "Quick Actions",
    "dashboard.sevenDaySales": "7-day sales",
    "dashboard.thirtyDaySales": "30-day sales",
    "dashboard.pendingUdhar": "Pending udhar",
    "dashboard.lowStock": "Low stock",
    "dashboard.pendingSync": "Pending sync",
    "settings.title": "Settings",
    "settings.subtitle": "Profile, shop, language, security and advanced tools",
    "settings.profile": "Profile",
    "settings.shop": "Shop",
    "settings.language": "Language",
    "settings.advanced": "Advanced",
    "settings.security": "Security",
    "settings.profileTitle": "Owner profile",
    "settings.languageTitle": "Language mode",
    "settings.languageHelp": "Choose one app language. The main shell will not show English and Hindi together.",
    "settings.english": "English",
    "settings.hindi": "Hindi / Hinglish",
    "settings.advancedTitle": "Advanced tools moved here",
    "settings.advancedHelp": "Less-used admin modules stay available here so daily billing stays clean.",
  },
  hi: {
    "app.tagline": "तेज़ POS",
    "app.taglineHindi": "तेज़ POS",
    "status.online": "बैकएंड ऑनलाइन",
    "status.syncing": "क्लाउड बैकअप चल रहा है",
    "status.offline": "बैकएंड ऑफलाइन, बिलिंग चालू",
    "status.pendingBackup": "बदलाव बैकअप बाकी",
    "status.conflicts": "सिंक समस्या",
    "status.dataSafe": "डेटा फोन/कंप्यूटर में सुरक्षित है",
    "nav.dashboard": "होम",
    "nav.billing": "बिलिंग",
    "nav.bills": "बिल इतिहास",
    "nav.products": "माल",
    "nav.inventory": "स्टॉक",
    "nav.customers": "ग्राहक",
    "nav.udhar": "उधार",
    "nav.reports": "रिपोर्ट",
    "nav.closing": "दिन बंद",
    "nav.settings": "सेटिंग",
    "nav.suppliers": "सप्लायर",
    "nav.staff": "स्टाफ",
    "nav.devices": "डिवाइस",
    "nav.sync": "बैकअप",
    "nav.smartTools": "स्मार्ट टूल",
    "nav.recovery": "रिकवरी",
    "nav.auditLogs": "लॉग",
    "nav.recycleBin": "रीस्टोर",
    "nav.plans": "प्लान",
    "nav.subscription": "सब्सक्रिप्शन",
    "dashboard.title": "होम",
    "dashboard.newBill": "नया बिल",
    "dashboard.localSource": "डैशबोर्ड लोकल डेटा से चलता है। क्लाउड refresh background में होता है।",
    "dashboard.todayRevenue": "आज की बिक्री",
    "dashboard.todayProfit": "आज का मुनाफा",
    "dashboard.totalUdhar": "कुल उधार",
    "dashboard.cashCollected": "कैश मिला",
    "dashboard.payments": "आज की पेमेंट",
    "dashboard.udharOutstanding": "बाकी उधार",
    "dashboard.viewAll": "सभी देखें",
    "dashboard.noUdhar": "कोई उधार बाकी नहीं",
    "dashboard.ownerWidgets": "मालिक रिपोर्ट",
    "dashboard.openReports": "रिपोर्ट खोलें",
    "dashboard.localEstimate": "Pending backup होने तक रिपोर्ट local estimate है।",
    "dashboard.quickActions": "जल्दी काम",
    "dashboard.sevenDaySales": "7 दिन बिक्री",
    "dashboard.thirtyDaySales": "30 दिन बिक्री",
    "dashboard.pendingUdhar": "बाकी उधार",
    "dashboard.lowStock": "कम स्टॉक",
    "dashboard.pendingSync": "बैकअप बाकी",
    "settings.title": "सेटिंग",
    "settings.subtitle": "प्रोफाइल, दुकान, भाषा, सिक्योरिटी और advanced tools",
    "settings.profile": "प्रोफाइल",
    "settings.shop": "दुकान",
    "settings.language": "भाषा",
    "settings.advanced": "Advanced",
    "settings.security": "सुरक्षा",
    "settings.profileTitle": "मालिक प्रोफाइल",
    "settings.languageTitle": "भाषा मोड",
    "settings.languageHelp": "एक भाषा चुनें। Main app English और Hindi साथ-साथ नहीं दिखाएगा।",
    "settings.english": "English",
    "settings.hindi": "Hindi / Hinglish",
    "settings.advancedTitle": "कम इस्तेमाल वाले tools यहां रखे हैं",
    "settings.advancedHelp": "Daily billing clean रखने के लिए admin modules settings में मिलेंगे।",
  },
};

interface AppLanguageContextValue {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  t: (key: TranslationKey) => string;
}

const AppLanguageContext = createContext<AppLanguageContextValue | null>(null);

function getInitialLanguage(): AppLanguage {
  if (typeof window === "undefined") return "en";
  const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return raw === "hi" ? "hi" : "en";
}

export function AppLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(getInitialLanguage);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = language === "hi" ? "hi" : "en";
    if (typeof window !== "undefined") window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  const setLanguage = useCallback((nextLanguage: AppLanguage) => setLanguageState(nextLanguage), []);
  const t = useCallback((key: TranslationKey) => translations[language][key] ?? translations.en[key], [language]);
  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <AppLanguageContext.Provider value={value}>{children}</AppLanguageContext.Provider>;
}

export function useAppLanguage() {
  const context = useContext(AppLanguageContext);
  if (!context) throw new Error("useAppLanguage must be used inside AppLanguageProvider");
  return context;
}
