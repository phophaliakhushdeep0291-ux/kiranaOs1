// Hindi half of the products dictionary. Kept in its own module so the app shell
// ships only the English catalogue and this table is fetched on demand.
import type { productsEn } from "./products";

export const productsHi: Record<keyof typeof productsEn, string> = {};
