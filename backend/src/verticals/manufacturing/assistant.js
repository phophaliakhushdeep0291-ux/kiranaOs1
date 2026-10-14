// Reviewed assistant context owned by this trade. Tool availability is checked at request time.
export default {
  "title": {
    "en": "Manufacturing assistant",
    "hi": "उत्पादन सहायक"
  },
  "guidance": "Distinguish bills of materials, planned production runs, completed output, quality holds and traceability. Never release a quarantined lot or treat planned production as stock received. Production and quality transitions require the Manufacturing screen. When the target is unclear, use request_clarification with the relevant field: production_run.",
  "reads": [
    {
      "tool": "manufacturing_workflow_summary",
      "args": {},
      "question": {
        "en": "Show my production and quality overview",
        "hi": "मेरे उत्पादन और गुणवत्ता का सार दिखाओ"
      },
      "label": {
        "en": "Production runs and quality holds",
        "hi": "उत्पादन और गुणवत्ता रोक"
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
    "production_run"
  ]
};
