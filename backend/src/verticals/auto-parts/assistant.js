// Reviewed assistant context owned by this trade. Tool availability is checked at request time.
export default {
  "title": {
    "en": "Auto-parts assistant",
    "hi": "ऑटो पार्ट्स सहायक"
  },
  "guidance": "Use vehicle fitment records. Ask for vehicle make, model, year and part when compatibility is ambiguous. Summary counts are not proof that a part fits a vehicle. Fitment changes use the fitment screen. When the target is unclear, use request_clarification with the relevant field: vehicle.",
  "reads": [
    {
      "tool": "auto_parts_workflow_summary",
      "args": {},
      "question": {
        "en": "Show my vehicle fitment register summary",
        "hi": "मेरे वाहन फिटमेंट रजिस्टर का सार दिखाओ"
      },
      "label": {
        "en": "Fitment coverage and part references",
        "hi": "फिटमेंट कवरेज और पार्ट संदर्भ"
      }
    },
    {
      "tool": "get_inventory_health",
      "args": {},
      "question": {
        "en": "Show my stock health",
        "hi": "मेरे स्टॉक की स्थिति दिखाओ"
      },
      "label": {
        "en": "Stock health",
        "hi": "स्टॉक की स्थिति"
      }
    }
  ],
  "clarificationFields": [
    "vehicle"
  ]
};
