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

  // ── Shared across screens ──
  "assurance.disclaimer": "Automatic checking of your own entries. What it finds are things worth a look — not proof that anyone did wrong, not a government audit, and not a replacement for your CA.",
  "assurance.from": "From",
  "assurance.to": "To",
  "assurance.notFound": "Not found",
  "assurance.loadFailed": "Could not load this",
  "assurance.select": "Pick one to see it",

  // ── Proof (evidence) screen ──
  "assurance.proofPage.title": "Proof asked for",
  "assurance.proofPage.subtitle": "Bills, photos and notes still to be attached",
  "assurance.proofPage.filterOutstanding": "Still pending",
  "assurance.proofPage.empty": "Nothing pending",
  "assurance.proofPage.emptyHint": "No problem is waiting on a bill or photo right now.",
  "assurance.proofPage.askedOn": "Asked on {when}",

  // ── Runs screen ──
  "assurance.runs.title": "Check history",
  "assurance.runs.subtitle": "Every time the books were checked, and what came out of it",
  "assurance.runs.start": "Run a check",
  "assurance.runs.startHint": "Checks every entry made in the days you pick",
  "assurance.runs.recent": "Recent checks",
  "assurance.runs.none": "No checks yet",
  "assurance.runs.noneHint": "Start one above.",
  "assurance.runs.detail": "What this check found",
  "assurance.runs.pick": "Pick a check to see it",
  "assurance.runs.checked": "Entries checked",
  "assurance.runs.newProblems": "New problems",
  "assurance.runs.updated": "Updated",
  "assurance.runs.started": "Started",
  "assurance.runs.finished": "Finished",
  "assurance.runs.record": "Record",
  "assurance.runs.failed": "Check failed",

  // ── Rules screen ──
  "assurance.rules.title": "What gets checked",
  "assurance.rules.subtitle": "Every check the app runs on your books. Switch off any that do not fit your shop.",
  "assurance.rules.search": "Search checks",
  "assurance.rules.allAreas": "All areas",
  "assurance.rules.none": "No checks match",
  "assurance.rules.count": "{count} checks",
  "assurance.rules.off": "Off",
  "assurance.rules.customWeight": "Custom importance",
  "assurance.rules.updateFailed": "Could not change this check",

  // ── Cases screen ──
  "assurance.cases.title": "Grouped problems",
  "assurance.cases.subtitle": "Problems that share a customer, supplier, person, day or cause",
  "assurance.cases.suggested": "Suggested groups",
  "assurance.cases.suggestedHint": "Grouped because they really are connected in your data — nothing opens until you say so",
  "assurance.cases.noneSuggested": "No groups suggested",
  "assurance.cases.noneSuggestedHint": "{count} open problems looked at. A group appears when two or more share a customer, supplier, person, day or cause.",
  "assurance.cases.open": "Open groups",
  "assurance.cases.openHint": "Pick a group to see what is inside",
  "assurance.cases.none": "No groups yet",
  "assurance.cases.noneHint": "Open one from a suggestion above.",
  "assurance.cases.detail": "Group detail",
  "assurance.cases.detailHint": "Each problem inside still gets decided on its own",
  "assurance.cases.opened": "Group opened",
  "assurance.cases.openFailed": "Could not open the group",
  "assurance.cases.updateFailed": "Could not update the group",

  // ── Report screen ──
  "assurance.report.title": "Money check report",
  "assurance.report.subtitle": "A period summary you can hand to your CA",
  "assurance.report.generate": "Make report",
  "assurance.report.failed": "Could not make the report",
  "assurance.report.reviewed": "Entries checked",
  "assurance.report.raised": "Problems found",
  "assurance.report.resolvedIn": "{count} settled in this period",
  "assurance.report.areas": "By area",
  "assurance.report.areasHint": "Where the problems came from",
  "assurance.report.frequent": "Happens most often",
  "assurance.report.frequentHint": "The checks that flagged most in this period",
  "assurance.report.noneInPeriod": "Nothing found in this period",
  "assurance.report.response": "Proof and what you decided",
  "assurance.report.responseHint": "What was asked for, and what the shop said",
  "assurance.report.noReviews": "No notes recorded in this period.",
  "assurance.report.noResolutions": "Nothing settled in this period.",
  "assurance.report.criticalOpen": "Still to see first",
  "assurance.report.criticalOpenHint": "These need attention before anything else",
  "assurance.report.criticalNone": "Nothing urgent is open",
  "assurance.report.limits": "What this does not tell you",
  "assurance.report.limitsHint": "Read this before treating the report as complete",

  // ── Finding detail ──
  "assurance.detail.notFound": "This problem was not found",
  "assurance.detail.notFoundHint": "It may belong to another shop, or the link is wrong.",
  "assurance.detail.why": "Why this came up",
  "assurance.detail.whyHint": "Each check below compares your own numbers",
  "assurance.detail.noRules": "Nothing is flagging any more",
  "assurance.detail.noRulesHint": "It may already have been corrected.",
  "assurance.detail.record": "The entry itself",
  "assurance.detail.recordHint": "Shown as it is — nothing here can be edited",
  "assurance.detail.explain": "Explain in simple words",
  "assurance.detail.explainHint": "Rewords what was found. It never changes a number.",
  "assurance.detail.noExplanation": "Not asked for yet",
  "assurance.detail.noExplanationHint": "Use Explain for a longer plain-language summary.",
  "assurance.detail.decide": "Your decision",
  "assurance.detail.decideHint": "Every change is kept permanently",
  "assurance.detail.comment": "Note (recommended)",
  "assurance.detail.commentHint": "What did you find?",
  "assurance.detail.proofAsked": "Proof asked for",
  "assurance.detail.proofAskedHint": "Raised automatically by the checks above",
  "assurance.detail.proofNothing": "Nothing outstanding.",
  "assurance.detail.proofAskMore": "Ask for more proof",
  "assurance.detail.proofWhat": "What exactly is needed?",
  "assurance.detail.proofGiven": "Proof given",
  "assurance.detail.proofGivenHint": "Nothing is accepted automatically — someone has to accept it",
  "assurance.detail.proofNone": "Nothing given yet.",
  "assurance.detail.proofSubmit": "Give proof",
  "assurance.detail.proofPlaceholder": "Bill no., UPI reference, or a written explanation",
  "assurance.detail.notes": "Notes",
  "assurance.detail.addNote": "Add a note",
  "assurance.detail.history": "History",
  "assurance.detail.historyHint": "Everything that happened to this, oldest first",
  "assurance.detail.confidence": "Confidence {percent}%",
  "assurance.detail.reopened": "Came back ×{count}",
  "assurance.detail.scoreRule": "Rule",
  "assurance.detail.scoreSeverity": "Seriousness",
  "assurance.detail.scoreWeight": "Weight",
  "assurance.detail.scoreMultiplier": "× Seriousness",
  "assurance.detail.scoreRaw": "Raw",
  "assurance.detail.scoreContribution": "Adds",

  // ── Decisions the owner can take on a problem ──
  "assurance.act.UNDER_REVIEW": "I am looking into it",
  "assurance.act.UNDER_REVIEW.hint": "Still checking",
  "assurance.act.CONFIRMED_ISSUE": "This is wrong",
  "assurance.act.CONFIRMED_ISSUE.hint": "Something really did go wrong here",
  "assurance.act.CORRECTED": "I fixed it",
  "assurance.act.CORRECTED.hint": "Put right through the normal screens",
  "assurance.act.FALSE_POSITIVE": "This is fine",
  "assurance.act.FALSE_POSITIVE.hint": "The entries are actually correct",
  "assurance.act.ACCEPTED_RISK": "Leave it",
  "assurance.act.ACCEPTED_RISK.hint": "I know about it and it is alright",
  "assurance.act.CLOSED": "Done with it",
  "assurance.act.CLOSED.hint": "Nothing more to do",

  // ── Dashboard, lower half ──
  "assurance.period.1": "Last 24 hours",
  "assurance.period.7": "Last 7 days",
  "assurance.period.30": "Last 30 days",
  "assurance.period.90": "Last 90 days",
  "assurance.period.label": "How far back",
  "assurance.viewAll": "See all",
  "assurance.allChecks": "All checks",
  "assurance.dash.loadFailed": "Could not open the money check",
  "assurance.dash.trend": "Problems over time",
  "assurance.dash.trendHint": "New problems found each day, last 30 days",
  "assurance.dash.noneYet": "Nothing found yet",
  "assurance.dash.noneYetHint": "Run a check on your recent entries.",
  "assurance.dash.byArea": "Where the problems are",
  "assurance.dash.byAreaHint": "Open problems by part of the business",
  "assurance.dash.nothingOpen": "Nothing open",
  "assurance.dash.nothingOpenHint": "No open problems anywhere.",
  "assurance.dash.top": "See these first",
  "assurance.dash.topHint": "Biggest first",
  "assurance.dash.lastRun": "Last check",
  "assurance.dash.lastRunHint": "The most recent time your books were checked",
  "assurance.dash.type": "How it ran",
  "assurance.dash.topAreas": "Most common problems",
  "assurance.dash.topAreasHint": "The checks that catch something most often in your shop",
  "assurance.dash.nothingTriggering": "Nothing is flagging",
  "assurance.dash.affected": "Who and what is involved",
  "assurance.dash.affectedHint": "Taken from the entries behind open problems — to follow up, not to blame",
  "assurance.dash.noneAffected": "Nobody.",
  "assurance.dash.engine": "Checking engine",
  "assurance.dash.engineHint": "The checks run whether or not the internet or AI is available",
  "assurance.dash.localSummaries": "plain-language summaries are made on this device",
  "assurance.dash.baselinesDone": "Your own averages refreshed",
  "assurance.dash.baselinesFailed": "Could not refresh your averages",

  // ── Filters and small labels ──
  "assurance.filter.allStatuses": "Any state",
  "assurance.filter.allRisk": "Any seriousness",
  "assurance.filter.allTypes": "Any record",
  "assurance.filter.status": "Filter by state",
  "assurance.filter.risk": "Filter by seriousness",
  "assurance.filter.type": "Filter by record",
  "assurance.filter.area": "Filter by area",
  "assurance.filter.ruleCode": "Check code, e.g. BILL_TOTAL_MISMATCH",
  "assurance.score": "Score",
  "assurance.checks": "Checks",
  "assurance.engine": "Engine",
  "assurance.ruleSet": "Rule set",
  "assurance.custom": "(your own)",
  "assurance.capped": "(capped)",
  "assurance.baseScore": "Base score",
  "assurance.finalScore": "Final score",
  "assurance.confidenceLabel": "Confidence",
  "assurance.lang": "Language",
  "assurance.back": "Back",
  "assurance.notStatutory": "not a government audit report",

  // ── Detail-page toasts ──
  "assurance.toast.statusFailed": "Could not change this",
  "assurance.toast.proofSaved": "Proof saved",
  "assurance.toast.proofFailed": "Could not save the proof",
  "assurance.toast.proofAsked": "Proof asked for",
  "assurance.toast.proofAskFailed": "Could not ask for proof",
  "assurance.toast.proofUpdateFailed": "Could not update the proof",
  "assurance.toast.noteAdded": "Note added",
  "assurance.toast.noteFailed": "Could not add the note",
  "assurance.toast.explainFailed": "Could not explain this",

  // ── Shared vocabulary ────────────────────────────────────────
  // Every page renders statuses, categories and record types through these, so
  // translating them once fixes the words on all nine screens. The engine's own
  // enum names (CONFIRMED_ISSUE, SYNC_INTEGRITY) never reach the owner.
  "assurance.status.OPEN": "To look at",
  "assurance.status.EVIDENCE_REQUESTED": "Proof asked for",
  "assurance.status.UNDER_REVIEW": "Being checked",
  "assurance.status.CONFIRMED_ISSUE": "Really wrong",
  "assurance.status.FALSE_POSITIVE": "Was fine",
  "assurance.status.CORRECTED": "Fixed",
  "assurance.status.ACCEPTED_RISK": "Left as is",
  "assurance.status.CLOSED": "Done",

  "assurance.risk.LOW": "Small",
  "assurance.risk.MEDIUM": "Worth a look",
  "assurance.risk.HIGH": "Serious",
  "assurance.risk.CRITICAL": "See first",

  "assurance.entity.BILL": "Bill",
  "assurance.entity.CUSTOMER": "Khata",
  "assurance.entity.PRODUCT": "Item",
  "assurance.entity.PURCHASE": "Purchase",
  "assurance.entity.EXPENSE": "Kharcha",
  "assurance.entity.DAILY_CLOSING": "Day closing",
  "assurance.entity.SYNC_EVENT": "Sync",

  "assurance.area.BILLING": "Billing",
  "assurance.area.RECONCILIATION": "Matching up",
  "assurance.area.CUSTOMER_CREDIT": "Khata / udhar",
  "assurance.area.INVENTORY": "Stock",
  "assurance.area.PURCHASE": "Purchases",
  "assurance.area.EXPENSE": "Kharcha",
  "assurance.area.CASH_CLOSING": "Gallā & day closing",
  "assurance.area.SYNC_INTEGRITY": "Sync",
  "assurance.area.AUTHORIZATION": "Permissions",

  "assurance.proof.REQUESTED": "Asked for",
  "assurance.proof.PROVIDED": "Given",
  "assurance.proof.VERIFIED": "Accepted",
  "assurance.proof.REJECTED": "Not accepted",
  "assurance.proof.INSUFFICIENT": "Not enough",
  "assurance.proof.NOT_APPLICABLE": "Not needed",

  "assurance.runType.MANUAL": "You ran it",
  "assurance.runType.SCHEDULED": "Ran on its own",
  "assurance.runType.TRANSACTION_TRIGGERED": "Ran after an entry",
  "assurance.runStatus.RUNNING": "Running",
  "assurance.runStatus.COMPLETED": "Finished",
  "assurance.runStatus.FAILED": "Failed",
  "assurance.runStatus.PARTIAL": "Finished with errors",

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
