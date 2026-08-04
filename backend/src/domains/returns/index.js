// Customer returns are part of the shared sale transaction service; supplier
// returns have their own service and routes.
export * as customerReturnService from "../../modules/bills/bills.service.js";
export * as supplierReturnService from "../../modules/purchase-returns/purchaseReturns.service.js";
export { default as supplierReturnRoutes } from "../../modules/purchase-returns/purchaseReturns.routes.js";
