// Reviewed assistant context owned by this trade. Tool availability is checked at request time.
export default {
  "title": {
    "en": "Books and stationery assistant",
    "hi": "किताब और स्टेशनरी सहायक"
  },
  "guidance": "Distinguish a school/class/year book list from individual books and bundles. Ask for the school, class and academic year when a requested set is ambiguous. List coverage counts do not prove all books are in stock. Book-list edits need their screen. When the target is unclear, use request_clarification with the relevant field: school_list.",
  "reads": [
    {
      "tool": "stationery_workflow_summary",
      "args": {},
      "question": {
        "en": "Show my school book-list summary",
        "hi": "मेरी स्कूल किताब सूचियों का सार दिखाओ"
      },
      "label": {
        "en": "School, class and book-list coverage",
        "hi": "स्कूल, कक्षा और किताब सूची कवरेज"
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
    "school_list"
  ]
};
