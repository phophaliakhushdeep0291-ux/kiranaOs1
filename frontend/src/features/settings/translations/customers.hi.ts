// Hindi half of the customers dictionary. Kept in its own module so the app shell
// ships only the English catalogue and this table is fetched on demand.
import type { customersEn } from "./customers";

export const customersHi: Record<keyof typeof customersEn, string> = {};
