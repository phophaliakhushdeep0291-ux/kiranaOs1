// Reviewed assistant context owned by this trade. Tool availability is checked at request time.
export default {
  "title": {
    "en": "Business assistant",
    "hi": "व्यवसाय सहायक"
  },
  "guidance": "This is a configurable business. Ask about the workflow if its meaning is unclear. Offer only the registered tools and enabled screens. Do not pretend restaurant, medical, serial or other specialist automation is available from a custom business label. When the target is unclear, use request_clarification with the relevant field: topic.",
  "reads": [
    {
      "tool": "get_sales_summary",
      "args": {
        "range": "today"
      },
      "question": {
        "en": "Show sales for today",
        "hi": "आज की बिक्री दिखाओ"
      },
      "label": {
        "en": "Sales reports",
        "hi": "बिक्री रिपोर्ट"
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
    },
    {
      "tool": "get_udhar_summary",
      "args": {},
      "question": {
        "en": "Show my total outstanding credit",
        "hi": "मेरा कुल बकाया उधार दिखाओ"
      },
      "label": {
        "en": "Outstanding credit",
        "hi": "बकाया उधार"
      }
    }
  ],
  "clarificationFields": [
    "topic"
  ]
};
