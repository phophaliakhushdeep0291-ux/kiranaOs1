// Financial assurance, in the words a shopkeeper actually uses.
//
// The engine's own rule names are written for an auditor ("Closing cash figure
// does not match the day's cash payments"). They are correct, and they stay —
// on the detail screen, behind a disclosure, because they are what makes a
// finding defensible. What the owner reads FIRST is this table.
//
// Two register rules, both borrowed from billing and orders:
//   * money leads. Every headline opens with the rupees in question, because
//     that is the only number a counter decides anything on.
//   * words the shop already says stay as loanwords — गल्ला, स्टॉक, बिल, UPI.
//     "वित्तीय आश्वासन" is dictionary Hindi nobody says out loud.
//
// A rule with no entry here falls back to the engine's English name, so this
// table can grow one rule at a time without a gap ever showing.
export const assuranceEn = {
  // ── The module, renamed ──
  // "Assurance" and "findings" are audit words. The shop calls this checking
  // the books, and what comes out of it is a गड़बड़ — something that does not
  // add up. Not yet an accusation, which is exactly the right strength.
  "assurance.title": "Money check",
  "assurance.subtitle": "Checks your bills, khata, stock, purchases and gallā against each other",
  "assurance.run": "Check now",
  "assurance.running": "Checking…",
  "assurance.runDone": "Check finished",
  "assurance.runDoneDetail": "{count} entries checked · {created} new problems found",

  // ── Headline numbers ──
  "assurance.stat.toCheck": "Money to check",
  "assurance.stat.toCheckHint": "Not a confirmed loss — this much needs a look",
  "assurance.stat.problems": "Open problems",
  "assurance.stat.problemsHint": "Nothing decided yet",
  "assurance.stat.urgent": "See first",
  "assurance.stat.urgentHint": "Biggest gap, oldest first",
  "assurance.stat.proof": "Proof pending",
  "assurance.stat.proofHint": "Bill or photo still to attach",

  "assurance.empty.title": "Nothing to check",
  "assurance.empty.hint": "Your bills, stock and gallā agree with each other.",
  "assurance.lastChecked": "Last checked {when}",
  "assurance.neverChecked": "Not checked yet",

  // ── What the owner does about it ──
  "assurance.action.fine": "This is fine",
  "assurance.action.problem": "This is wrong",
  "assurance.action.later": "Look later",
  "assurance.whyFlagged": "Why did this come up?",
  "assurance.whatToDo": "What to do",
  "assurance.auditorView": "Auditor detail",
  "assurance.auditorViewHint": "Rule codes, weights and the score — for your CA",
  "assurance.reference": "Reference",
  "assurance.item": "this item",

  // ── Rule messages ─────────────────────────────────────────────
  // Each is built from numbers the rule already returns. No AI, no network.
  // `{amount}` is always pre-formatted rupees; `{qty}` a base-unit quantity.

  // Cash / daily closing
  "assurance.rule.CLOSING_CASH_FIGURE_STALE.head": "Gallā is short by {amount}",
  "assurance.rule.CLOSING_CASH_FIGURE_STALE.body":
    "Cash from bills and khata recovery comes to {expected}, but the day's closing says {recorded}.",
  "assurance.rule.CLOSING_CASH_FIGURE_STALE.do": "Redo that day's closing. If it is locked, open it, refresh, lock again.",
  "assurance.rule.CLOSING_CASH_FIGURE_STALE.over": "Gallā shows {amount} more than the bills",

  "assurance.rule.CLOSING_CASH_EXPENSES_NOT_DEDUCTED.head": "{amount} of cash is unaccounted for",
  "assurance.rule.CLOSING_CASH_EXPENSES_NOT_DEDUCTED.body":
    "After cash sales, khata recovery, supplier payments and cash kharcha, the gallā should hold {expected} — the closing says {recorded}.",
  "assurance.rule.CLOSING_CASH_EXPENSES_NOT_DEDUCTED.do":
    "Check whether a cash kharcha or a supplier payment was left out of that day.",

  "assurance.rule.CLOSING_UPI_FIGURE_STALE.head": "UPI total is off by {amount}",
  "assurance.rule.CLOSING_UPI_FIGURE_STALE.body":
    "UPI on the bills comes to {expected}, but the day's closing says {recorded}.",
  "assurance.rule.CLOSING_UPI_FIGURE_STALE.do": "Match the day against the UPI app statement, then redo the closing.",

  // Stock
  "assurance.rule.STOCK_NEGATIVE_BALANCE.head": "{name} shows minus stock",
  "assurance.rule.STOCK_NEGATIVE_BALANCE.body":
    "{qty} more was sold than the app knows came in. Usually a purchase that was never entered.",
  "assurance.rule.STOCK_NEGATIVE_BALANCE.do": "Enter the missing purchase bill, or count the item and correct the stock.",

  "assurance.rule.STOCK_DECREASE_WITHOUT_SOURCE.head": "{qty} of {name} left without a bill",
  "assurance.rule.STOCK_DECREASE_WITHOUT_SOURCE.body1":
    "One stock movement took goods out with no sale, damage, transfer or correction behind it.",
  "assurance.rule.STOCK_DECREASE_WITHOUT_SOURCE.body":
    "{count} stock movements took goods out with no sale, damage, transfer or correction behind them.",
  "assurance.rule.STOCK_DECREASE_WITHOUT_SOURCE.do":
    "Ask what left the shelf. Stock going out with nothing behind it is the clearest sign of leakage.",

  "assurance.rule.STOCK_INCREASE_WITHOUT_SOURCE.head": "{name} stock went up with no purchase bill",
  "assurance.rule.STOCK_INCREASE_WITHOUT_SOURCE.body1":
    "One stock movement added goods without a purchase, return or noted correction.",
  "assurance.rule.STOCK_INCREASE_WITHOUT_SOURCE.body":
    "{count} stock movements added goods without a purchase, return or noted correction.",
  "assurance.rule.STOCK_INCREASE_WITHOUT_SOURCE.do": "Attach the purchase bill or goods-receipt note for what came in.",

  "assurance.rule.STOCK_SALE_EXCEEDED_AVAILABLE.head": "{name} was sold beyond available stock",
  "assurance.rule.STOCK_SALE_EXCEEDED_AVAILABLE.body1":
    "One sale pushed this item below zero — the stock was not there to sell.",
  "assurance.rule.STOCK_SALE_EXCEEDED_AVAILABLE.body":
    "{count} sales pushed this item below zero — the stock was not there to sell.",
  "assurance.rule.STOCK_SALE_EXCEEDED_AVAILABLE.do":
    "Enter the purchase that was missed, or count the item and post a correction.",

  // ── Fallback for rules not yet rewritten ──
  "assurance.rule.generic.body": "Checked automatically against your own entries.",
} as const;
