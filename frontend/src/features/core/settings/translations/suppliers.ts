// Suppliers screen — the list, the add/edit dialog and the delete confirmation.
//
// Same register rule as billing and products: words the shop already says in
// English ("GSTIN", "GST", "CGST", "SGST", "IGST", "मोबाइल") stay as loanwords
// in Devanagari rather than being replaced by textbook Hindi nobody uses.
//
// The trade block at the end is what makes this screen belong to a shop: a
// chemist buys from distributors, a factory from vendors, a kirana store from
// wholesalers. See settings/shop-suppliers.ts.
export const suppliersEn = {
  // ── List ──
  // {supplier} is the trade's own word, so one phrase covers twelve trades in
  // both languages. See settings/shop-suppliers.ts.
  "suppliers.count.one": "1 {supplier}",
  "suppliers.count.many": "{count} {supplier}",
  "suppliers.add": "Add {supplier}",
  "suppliers.search.placeholder": "Search by name or mobile...",
  "suppliers.empty.noMatch": "No {supplier} match your search",
  "suppliers.empty.none": "No {supplier} yet — add your first one",
  "suppliers.row.edit": "Edit {name}",
  "suppliers.row.delete": "Delete {name}",
  "suppliers.row.statement": "Open {name} statement",

  "suppliers.statement.title": "{name} payable statement",
  "suppliers.statement.loading": "Loading supplier statement",
  "suppliers.statement.unavailable": "Statement is not available right now",
  "suppliers.statement.onlineRequired": "This verified statement needs a server connection. Your locally saved purchases are not removed; retry after reconnecting.",
  "suppliers.statement.retry": "Retry",
  "suppliers.statement.balanced": "Ledger and purchase dues match",
  "suppliers.statement.attention": "Statement needs reconciliation",
  "suppliers.statement.coverage": "{linked} linked purchases · {unlinked} same-name purchases still unlinked",
  "suppliers.statement.repair": "Repair linked history",
  "suppliers.statement.repaired": "Repaired {count} legacy purchases",
  "suppliers.statement.noRepairNeeded": "No linked history needed repair",
  "suppliers.statement.repairMore": "Repaired {count} purchases. Run repair again to finish the remaining history.",
  "suppliers.statement.from": "From date",
  "suppliers.statement.to": "To date",
  "suppliers.statement.currentDue": "Ledger due",
  "suppliers.statement.purchaseDue": "Purchase due",
  "suppliers.statement.opening": "Opening balance",
  "suppliers.statement.difference": "Difference",
  "suppliers.statement.date": "Date",
  "suppliers.statement.reference": "Reference",
  "suppliers.statement.purchase": "Purchase",
  "suppliers.statement.paid": "Paid / credit",
  "suppliers.statement.change": "Due change",
  "suppliers.statement.balance": "Balance",
  "suppliers.statement.empty": "No linked supplier transactions yet",
  "suppliers.statement.more": "More than 500 events match this period. Choose a shorter date range to see the remaining records.",
  "suppliers.statement.repairTitle": "Repair supplier statement",
  "suppliers.statement.repairDescription": "Rebuild only explicitly linked legacy purchases. Names are never guessed, and every repair is recorded in the audit trail.",
  "suppliers.statement.repairConfirm": "Verify and repair",

  // ── Add / edit dialog ──
  "suppliers.form.addTitle": "Add {supplier}",
  "suppliers.form.editTitle": "Edit {supplier}",
  "suppliers.form.name": "Name *",
  "suppliers.form.namePlaceholder": "Name of the firm or person",
  "suppliers.form.nameRequired": "Name required",
  "suppliers.form.mobile": "Mobile",
  "suppliers.form.address": "Address",
  "suppliers.form.gstin": "GSTIN",
  "suppliers.form.gstinInvalid": "Enter a valid 15-character GSTIN",
  "suppliers.form.gstinHelp": "Needed to claim input GST on this firm's bills. Its first two digits decide whether the tax is CGST+SGST or IGST.",
  "suppliers.form.cancel": "Cancel",
  "suppliers.form.save": "Save",
  "suppliers.form.addAction": "Add",

  // ── Toasts and delete ──
  "suppliers.toast.added": "{supplier} added",
  "suppliers.toast.updated": "{supplier} updated",
  "suppliers.toast.recycled": "{supplier} moved to recycle bin locally",
  "suppliers.toast.error": "Error",
  "suppliers.toast.failed": "Failed",
  "suppliers.toast.deleteBlocked": "Delete blocked",
  "suppliers.toast.ownerPinRequired": "Owner PIN is required.",
  "suppliers.delete.title": "Move to recycle bin",
  "suppliers.delete.description": "Delete {name}? This is a soft delete and will be queued for sync.",
  "suppliers.delete.thisOne": "this one",
  "suppliers.delete.confirm": "Move to recycle bin",

  // ── The trade's own word for who it buys from ──
  "suppliers.trade.title": "Buying, for your shop type",
  "suppliers.word.suppliers": "suppliers",
  "suppliers.word.supplier": "Supplier",
  "suppliers.word.distributors": "distributors",
  "suppliers.word.distributor": "Distributor",
  "suppliers.word.vendors": "vendors",
  "suppliers.word.vendor": "Vendor",

  "suppliers.trade.heading.kirana": "Suppliers and wholesalers",
  "suppliers.trade.heading.distributors": "Distributors and stockists",
  "suppliers.trade.heading.vendors": "Vendors and material suppliers",
  "suppliers.trade.heading.general": "Suppliers",

  "suppliers.trade.link.purchases": "Purchase bills",

  "suppliers.trade.focus.kirana": "Most kirana stock comes through two or three distributors on fixed days — record whose day is which, and the shelf stops running dry mid-week.",
  "suppliers.trade.focus.clothing": "Season buying is committed months ahead, so keep the agent or wholesaler for each label here rather than in a phone's contact list.",
  "suppliers.trade.focus.footwear": "The supplier who can fill a broken size run in a week is worth more than the one who is cheapest per pair. Record which is which.",
  "suppliers.trade.focus.autoParts": "Record the GSTIN for every distributor: parts carry real input GST, and a missing number is credit you paid for and cannot claim.",
  "suppliers.trade.focus.electronics": "High-value stock means high-value credit notes — keep the distributor's details exact so a warranty or price-protection claim has somewhere to go.",
  "suppliers.trade.focus.pharmacy": "Medicines come through stockists holding their own licences. Their GSTIN and details are what an inspection and a recall notice are both traced through.",
  "suppliers.trade.focus.stationery": "This trade buys in one rush before the term. Record which distributor carries which board's titles now, not in June.",
  "suppliers.trade.focus.furniture": "A made-to-order piece is only as reliable as the workshop behind it — keep the maker's contact against the lead time you quote customers.",
  "suppliers.trade.focus.cosmetics": "Beauty distributors control both stock and testers. Record the GSTIN so the input credit on high-MRP goods is actually claimable.",
  "suppliers.trade.focus.restaurant": "A kitchen buys daily from the market and monthly from distributors. Keep both here — the vegetable vendor matters more to a service than the gas agency.",
  "suppliers.trade.focus.manufacturing": "Every material lot is traced back to the vendor that supplied it, so a vendor record missing its GSTIN breaks both the input credit and the audit trail.",
  "suppliers.trade.focus.other": "Record the GSTIN for anyone you buy from regularly — it is what turns a purchase bill into claimable input credit.",
} as const;
