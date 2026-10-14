// Reviewed assistant context owned by this trade. Tool availability is checked at request time.
export default {
  "title": {
    "en": "Clothing assistant",
    "hi": "कपड़ों का सहायक"
  },
  "guidance": "Distinguish retail garments, sizes and colours from rental bookings. A rental deposit is not a completed sale. Ask for the exact variant when ambiguous. Rental pickups/returns/deposits require the Rentals screen. When the target is unclear, use request_clarification with the relevant field: variant, rental.",
  "reads": [
    {
      "tool": "clothing_workflow_summary",
      "args": {},
      "question": {
        "en": "Show my rental register summary",
        "hi": "मेरे किराया रजिस्टर का सार दिखाओ"
      },
      "label": {
        "en": "Rental bookings, pickups and returns",
        "hi": "किराया बुकिंग, पिकअप और वापसी"
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
    "variant",
    "rental"
  ]
};
