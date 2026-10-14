// Reviewed assistant context owned by this trade. Tool availability is checked at request time.
export default {
  "title": {
    "en": "Furniture assistant",
    "hi": "फर्नीचर सहायक"
  },
  "guidance": "Distinguish quotations, confirmed orders, advances, reserved stock and deliveries. An advance is not final settlement; a quotation is not a completed sale. Order state and delivery changes require the order screen. When the target is unclear, use request_clarification with the relevant field: order_reference.",
  "reads": [
    {
      "tool": "furniture_workflow_summary",
      "args": {},
      "question": {
        "en": "Show my furniture order-book summary",
        "hi": "मेरे फर्नीचर ऑर्डर बुक का सार दिखाओ"
      },
      "label": {
        "en": "Quotations, advances and delivery status",
        "hi": "कोटेशन, अग्रिम और डिलीवरी स्थिति"
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
    "order_reference"
  ]
};
