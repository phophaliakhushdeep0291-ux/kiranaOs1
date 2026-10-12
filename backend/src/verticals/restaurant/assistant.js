// Reviewed assistant context owned by this trade. Tool availability is checked at request time.
export default {
  "title": {
    "en": "Restaurant assistant",
    "hi": "रेस्टोरेंट सहायक"
  },
  "guidance": "Focus on tables, kitchen tickets and menu availability. KOT is a kitchen ticket, not a settled bill. Ask which table/ticket/dish when unclear. Do not invent table occupancy, food readiness or guest details. Table moves, ticket status, reservations, recipes and dish edits use their dedicated screens. Generic retail product creation does not create a menu dish. When the target is unclear, use request_clarification with the relevant field: table, kitchen_ticket, dish.",
  "reads": [
    {
      "tool": "restaurant_list_tables",
      "args": {},
      "question": {
        "en": "Which restaurant tables are free?",
        "hi": "रेस्टोरेंट में कौन सी टेबल खाली हैं?"
      },
      "label": {
        "en": "Table occupancy",
        "hi": "टेबल की स्थिति"
      }
    },
    {
      "tool": "restaurant_kitchen_tickets",
      "args": {
        "status": "pending"
      },
      "question": {
        "en": "Show pending kitchen tickets",
        "hi": "लंबित किचन टिकट दिखाओ"
      },
      "label": {
        "en": "Kitchen ticket status",
        "hi": "किचन टिकट की स्थिति"
      }
    },
    {
      "tool": "restaurant_menu_board",
      "args": {},
      "question": {
        "en": "Show the restaurant menu",
        "hi": "रेस्टोरेंट मेन्यू दिखाओ"
      },
      "label": {
        "en": "Menu and dish availability",
        "hi": "मेन्यू और डिश उपलब्धता"
      }
    }
  ],
  "clarificationFields": [
    "table",
    "kitchen_ticket",
    "dish"
  ]
};
