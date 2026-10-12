// Reviewed assistant context owned by this trade. Tool availability is checked at request time.
export default {
  "title": {
    "en": "Grocery assistant",
    "hi": "किराना सहायक"
  },
  "guidance": "Focus on loose quantities, selling units, pack sizes, low stock, credit and daily sales. Preserve kg/gram/litre conversions. A purchase receipt must use purchasing, not a stock correction. When the target is unclear, use request_clarification with the relevant field: product, quantity.",
  "reads": [
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
    },
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
    }
  ],
  "clarificationFields": [
    "product",
    "quantity"
  ]
};
