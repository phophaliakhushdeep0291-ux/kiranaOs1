// Stock: the inventory register, batch/expiry control, categories, counts and
// branch transfers.
//
// Kept apart from `products` on purpose. Products is the catalogue — what a shop
// sells and for how much. This is what is physically on the shelf right now, and
// it is read by different people at different moments: a counter hand checking
// stock, an owner posting a variance, a godown keeper moving cartons between
// branches. Merging the two produced a module nobody could scan.
export const inventoryEn = {
  // Shared column headings and verbs. These repeat across every stock table, so
  // they live once here rather than once per screen.
  "inventory.col.date": "Date",
  "inventory.col.reference": "Reference No.",
  "inventory.col.product": "Product",
  "inventory.col.category": "Category",
  "inventory.col.skuBarcode": "SKU / Barcode",
  "inventory.col.unit": "Unit",
  "inventory.col.stock": "Stock",
  "inventory.col.stockValue": "Stock Value",
  "inventory.col.quantity": "Quantity",
  "inventory.col.reason": "Reason",
  "inventory.col.note": "Note",
  "inventory.col.status": "Status",
  "inventory.col.action": "Action",
  "inventory.cancel": "Cancel",
  "inventory.edit": "Edit",
  "inventory.delete": "Delete",
  "inventory.saving": "Saving…",
  "inventory.loading": "Loading…",
  "inventory.stockIn": "Stock In",
  "inventory.stockOut": "Stock Out",

  // Stock levels, as shown on the register and in filters.
  "inventory.stock.inStock": "In Stock",
  "inventory.stock.lowStock": "Low Stock",
  "inventory.stock.outOfStock": "Out of Stock",
  "inventory.filter.allSuppliers": "All Suppliers",
  "inventory.filter.allTypes": "All Types",
  "inventory.filter.allStatus": "All Status",
  "inventory.type.packed": "Packed",
  "inventory.type.loose": "Loose",

  // Near-expiry banner.
  "inventory.nearExpiry.title": "Stock nearing expiry",
  "inventory.nearExpiry.atRisk": "at risk",

  // Movement history register.
  "inventory.register.loading": "Loading movement history...",

  // Stock in / stock out dialog.
  "inventory.movement.packaging": "Packaging",
  "inventory.movement.costPerUnit": "Cost / unit (₹)",
  "inventory.movement.supplier": "Supplier",
  "inventory.movement.costHelp": "Cost updates the product's weighted average cost.",
  "inventory.movement.pickProduct": "Pick a product first",
  "inventory.movement.invalidQuantity": "Enter a valid quantity",
  "inventory.movement.enterCost": "Enter purchase cost",
  "inventory.movement.enterCostHelp": "Stock in needs a cost so inventory value and cloud sync stay correct.",
  "inventory.movement.addFailed": "Could not add stock",
  "inventory.movement.outExceedsStock": "Stock out is more than available stock",
  "inventory.movement.removeFailed": "Could not remove stock",

  // Batch and expiry control.
  "inventory.lots.eyebrow": "Batch & expiry control",
  "inventory.lots.subtitle": "FEFO stock, expiry risk, quarantine, and recall control for every branch.",
  "inventory.lots.allStatuses": "All statuses",
  "inventory.lots.loading": "Loading batch ledger…",
  "inventory.lots.empty": "No batches match this view.",
  "inventory.lots.quarantine": "Quarantine",
  "inventory.lots.recall": "Recall",
  "inventory.lots.release": "Release",
  "inventory.lots.fefoHelp": "Expired, quarantined, and recalled batches are excluded from checkout. When several batches are saleable, Artha consumes the earliest expiry first.",
  "inventory.status.active": "Active",
  "inventory.status.inactive": "Inactive",
  "inventory.status.quarantined": "Quarantined",
  "inventory.status.recalled": "Recalled",
  "inventory.status.depleted": "Depleted",

  // Categories.
  "inventory.categories.name": "Category Name",
  "inventory.categories.parent": "Parent Category",
  "inventory.categories.products": "Products",
  "inventory.categories.empty": "No categories yet",
  "inventory.categories.emptyHelp": "Click \"Add Category\" to create your first one.",
  "inventory.categories.none": "None (root category)",
  "inventory.categories.nameRequired": "Category name required",
  "inventory.categories.exists": "Category already exists",
  "inventory.categories.updated": "Category updated",
  "inventory.categories.added": "Category added",
  "inventory.categories.deleted": "Category deleted",

  // Stock counts.
  "inventory.counts.eyebrow": "Audited branch inventory control",
  "inventory.counts.title": "Stock counts without guesswork",
  "inventory.counts.subtitle": "Count the shelf without seeing system quantities, review variances with an owner, then post one protected adjustment to the branch ledger.",
  "inventory.counts.start": "Start stock count",
  "inventory.counts.branchStatus": "Branch status",
  "inventory.counts.inProgress": "In progress",
  "inventory.counts.ready": "Ready",
  "inventory.counts.oneOpenPerLocation": "Only one open count per location",
  "inventory.counts.progress": "Count progress",
  "inventory.counts.appliedHistory": "Applied history",
  "inventory.counts.recentSessions": "Most recent 30 sessions shown",
  "inventory.counts.sessions": "Count sessions",
  "inventory.counts.currentBranchOnly": "Current branch only",
  "inventory.counts.empty": "No stock counts yet",
  "inventory.counts.emptyHelp": "Start a count to reconcile this branch",
  "inventory.counts.snapshotHelp": "A frozen snapshot keeps every variance explainable.",
  "inventory.counts.blind": "Blind",
  "inventory.counts.apply": "Apply inventory",
  "inventory.counts.expected": "Expected",
  "inventory.counts.counted": "Counted",
  "inventory.counts.variance": "Variance",
  "inventory.counts.previous": "Previous",
  "inventory.counts.next": "Next",
  "inventory.counts.startTitle": "Start branch stock count",
  "inventory.counts.startHelp": "Current quantities are snapshotted now. Sales or other stock movement after this point will block posting and protect live inventory.",
  "inventory.counts.name": "Count name",
  "inventory.counts.blindRecommended": "Blind count (recommended)",
  "inventory.counts.blindHelp": "Counters cannot see expected stock until every product is submitted, reducing confirmation bias.",
  "inventory.counts.scopeHelp": "All active products in the selected branch will be included. Switch branches from the header before starting if needed.",
  "inventory.counts.started": "Stock count started",
  "inventory.counts.notStarted": "Count not started",
  "inventory.counts.progressSaved": "Progress saved",
  "inventory.counts.resumeSafely": "This count can be resumed safely on the branch.",
  "inventory.counts.progressNotSaved": "Progress not saved",
  "inventory.counts.readyForReview": "Ready for owner review",
  "inventory.counts.variancesVisible": "Expected quantities and variances are now visible.",
  "inventory.counts.notSubmitted": "Count not submitted",
  "inventory.counts.chooseCountFirst": "Choose a stock count first.",
  "inventory.counts.countsMustBeZeroOrMore": "Every changed count must be zero or more.",
  "inventory.counts.chooseCount": "Choose a count first.",
  "inventory.counts.noActionSelected": "No stock count action is selected.",
} as const;
