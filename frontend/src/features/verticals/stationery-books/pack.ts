import { GraduationCap } from "lucide-react";
import type { VerticalPack } from "../types";

/**
 * Stationery & books.
 *
 * Two trades at one counter: loose stationery sold by the piece, and books
 * identified by ISBN and tied to a school's class book list. It keeps
 * `LOOSE_ITEMS` for the first half — pens and sheets go out singly.
 *
 * The book list is the second half, and it is the document this shop's year
 * turns on: a parent says "Class 6, DPS" and eleven books, four notebooks and a
 * geometry box have to be found. A list is a recipe, not stock and not an order
 * — readiness is recomputed against the live catalogue on every read, so it
 * cannot go stale between the shelf and the counter. Putting one on a bill hands
 * it to the ordinary open-bills workspace, so a book set settles through exactly
 * the same pricing, tax and tender path as any other sale.
 *
 * Still to come here: institutional orders (a school buying the sets itself
 * rather than sending parents), and ISBN lookup to fill a list from a scan.
 */
export const stationeryPack: VerticalPack = {
  id: "stationery-books",
  label: "Stationery & Books",
  businessTypes: ["stationery"],
  paths: ["/book-lists"],
  routes: [
    { path: "/book-lists", page: "stationery/book-lists", featureName: "academic_book_lists" },
  ],
  nav: [
    {
      href: "/book-lists",
      label: "shopType.nav.bookLists",
      Icon: GraduationCap,
      insertAfter: "/billing",
      mobile: { group: "Sell", helper: "shopType.nav.bookLists.helper" },
    },
  ],
  capabilities: [
    "BASIC_INVENTORY", "LOOSE_ITEMS", "ISBN_CATALOG", "ACADEMIC_BOOK_LISTS",
    "PRODUCT_BUNDLES", "INSTITUTIONAL_ORDERS", "QUOTATIONS",
  ],
};
