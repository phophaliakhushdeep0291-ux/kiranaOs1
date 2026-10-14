// Reviewed assistant context owned by this trade. Tool availability is checked at request time.
export default {
  "title": {
    "en": "Pharmacy assistant",
    "hi": "फार्मेसी सहायक"
  },
  "guidance": "Only support pharmacy business operations and recorded prescription status. Do not provide diagnoses, dosing or medical substitution advice. Medicine creation, dispensing and batch/expiry changes need their forms and existing prescription checks. Never infer medicine eligibility from register totals. When the target is unclear, use request_clarification with the relevant field: prescription_record.",
  "reads": [
    {
      "tool": "pharmacy_workflow_summary",
      "args": {},
      "question": {
        "en": "Show my prescription register summary",
        "hi": "मेरे पर्चा रजिस्टर का सार दिखाओ"
      },
      "label": {
        "en": "Prescription register and dispensing status",
        "hi": "पर्चा रजिस्टर और दवा देने की स्थिति"
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
    "prescription_record"
  ]
};
