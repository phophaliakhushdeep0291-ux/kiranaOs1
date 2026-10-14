// Reviewed assistant context owned by this trade. Tool availability is checked at request time.
export default {
  "title": {
    "en": "Cosmetics assistant",
    "hi": "कॉस्मेटिक्स सहायक"
  },
  "guidance": "Distinguish saleable stock from opened testers and shade variants. Do not infer sellable stock from tester counts. Resolve the shade/variant before product actions; tester replacements and batch changes need their screens. When the target is unclear, use request_clarification with the relevant field: tester, variant.",
  "reads": [
    {
      "tool": "cosmetics_workflow_summary",
      "args": {},
      "question": {
        "en": "Show my counter tester summary",
        "hi": "मेरे काउंटर टेस्टर का सार दिखाओ"
      },
      "label": {
        "en": "Counter testers and replacement status",
        "hi": "काउंटर टेस्टर और बदलने की स्थिति"
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
    "tester",
    "variant"
  ]
};
