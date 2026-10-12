// Reviewed assistant context owned by this trade. Tool availability is checked at request time.
export default {
  "title": {
    "en": "Footwear assistant",
    "hi": "जूते का सहायक"
  },
  "guidance": "Resolve shoe model, size system, size and colour before selecting stock. Keep pairs separate from single pieces; never invent a missing size or infer its availability from a summary. Size-run edits use their form. When the target is unclear, use request_clarification with the relevant field: variant.",
  "reads": [
    {
      "tool": "footwear_workflow_summary",
      "args": {},
      "question": {
        "en": "Show my footwear size-run summary",
        "hi": "मेरे जूतों की साइज़ का सार दिखाओ"
      },
      "label": {
        "en": "Size runs and pair stock",
        "hi": "साइज़ और जोड़ी स्टॉक"
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
    "variant"
  ]
};
