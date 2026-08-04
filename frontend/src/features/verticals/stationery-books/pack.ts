import type { VerticalPack } from "../types";

/**
 * Stationery & books.
 *
 * Two trades at one counter: loose stationery sold by the piece, and books
 * identified by ISBN and tied to a school's class book list. It keeps
 * `LOOSE_ITEMS` for the first half — pens and sheets go out singly.
 */
export const stationeryPack: VerticalPack = {
  id: "stationery-books",
  label: "Stationery & Books",
  businessTypes: ["stationery"],
  paths: [],
  routes: [],
  nav: [],
  capabilities: [
    "BASIC_INVENTORY", "LOOSE_ITEMS", "ISBN_CATALOG", "ACADEMIC_BOOK_LISTS",
    "PRODUCT_BUNDLES", "INSTITUTIONAL_ORDERS", "QUOTATIONS",
  ],
};
