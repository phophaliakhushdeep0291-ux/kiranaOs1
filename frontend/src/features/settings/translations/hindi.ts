// Every Hindi table in one module, so `i18n.tsx` can pull the whole Hindi
// dictionary with a single dynamic import and keep it out of the app shell.
// Nothing here may be imported statically from shell code — that would defeat
// the split and put the tables back into the startup download.
import { billingHi } from "./billing.hi";
import { customersHi } from "./customers.hi";
import { productsHi } from "./products.hi";
import { shellHi } from "./shell.hi";

export const hindiTranslations = { ...shellHi, ...billingHi, ...productsHi, ...customersHi };
