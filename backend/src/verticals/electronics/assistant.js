// Reviewed assistant context owned by this trade. Tool availability is checked at request time.
export default {
  "title": {
    "en": "Electronics assistant",
    "hi": "इलेक्ट्रॉनिक्स सहायक"
  },
  "guidance": "Distinguish product models from individual serial/IMEI units. Never invent a serial number, warranty expiry or service outcome. Register totals do not establish an individual unit's eligibility. Unit and service updates need their screen. When the target is unclear, use request_clarification with the relevant field: serial_unit.",
  "reads": [
    {
      "tool": "electronics_workflow_summary",
      "args": {},
      "question": {
        "en": "Show my serial and warranty register summary",
        "hi": "मेरे सीरियल और वारंटी रजिस्टर का सार दिखाओ"
      },
      "label": {
        "en": "Serial units, warranty and service register",
        "hi": "सीरियल यूनिट, वारंटी और सेवा रजिस्टर"
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
    "serial_unit"
  ]
};
