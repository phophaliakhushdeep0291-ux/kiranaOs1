import{b2 as t,ar as e,bH as n,T as r,aZ as a,a_ as o,J as i,aN as s,aY as c,bI as d}from"./index-CYG8yywH.js"
import{t as u}from"./sync-types-B187FdZc.js"
const l=new Set(["AUDIT_LOG_APPEND","SUBSCRIPTION_REFRESH","UPDATE_SETTINGS","STAFF_ACTION","DEVICE_ADD_PENDING","DEVICE_REMOVE_PENDING"]),_={CANCEL_BILL_PENDING:"CANCEL_BILL",RESTORE_BILL_PENDING:"RESTORE_DELETED_BILL",SOFT_DELETE_BILL_PENDING:"DELETE_BILL",CREATE_SALE_RETURN:"SALE_RETURN",DELETE_PRODUCT_PENDING:"DELETE_PRODUCT",RESTORE_PRODUCT_PENDING:"RESTORE_PRODUCT",DELETE_CUSTOMER_PENDING:"DELETE_CUSTOMER",RESTORE_CUSTOMER_PENDING:"RESTORE_CUSTOMER",DELETE_SUPPLIER_PENDING:"DELETE_SUPPLIER",RESTORE_SUPPLIER_PENDING:"RESTORE_SUPPLIER",RECORD_PAYMENT:"UDHAR_PAYMENT",REVERSE_PAYMENT:"REVERSE_UDHAR_PAYMENT",CREATE_LEDGER_ADJUSTMENT:"CREATE_LEDGER_ADJUSTMENT",STOCK_PURCHASE:"STOCK_PURCHASE",STOCK_PURCHASE_BATCH:"STOCK_PURCHASE_BATCH",STOCK_SALE:"STOCK_SALE",STOCK_DAMAGE:"ADJUST_STOCK",STOCK_CORRECTION:"ADJUST_STOCK",UPDATE_PURCHASE_BILL:"UPDATE_PURCHASE_BILL",DELETE_PURCHASE_BILL:"DELETE_PURCHASE_BILL",RECORD_SUPPLIER_PAYMENT:"RECORD_SUPPLIER_PAYMENT",REVERSE_SUPPLIER_PAYMENT:"REVERSE_SUPPLIER_PAYMENT",RECORD_DRAWER_COUNT:"RECORD_DRAWER_COUNT"},y={UDHAR_PAYMENT:"payment",CREATE_LEDGER_ADJUSTMENT:"ledger_entry",REVERSE_UDHAR_PAYMENT:"ledger_entry",STOCK_PURCHASE:"inventory_movement",STOCK_PURCHASE_BATCH:"inventory_movement",STOCK_SALE:"inventory_movement",ADJUST_STOCK:"inventory_movement",UPDATE_PURCHASE_BILL:"purchase_history",DELETE_PURCHASE_BILL:"purchase_history",RECORD_SUPPLIER_PAYMENT:"payment",REVERSE_SUPPLIER_PAYMENT:"payment",DELETE_CUSTOMER:"customer",RESTORE_CUSTOMER:"customer",CREATE_EXPENSE:"expense",RECORD_DRAWER_COUNT:"daily_closing"}
function p(t){return"object"==typeof t&&null!==t&&!Array.isArray(t)}function m(t,e=0){const n=Number(t??e)
return Number.isFinite(n)?n:e}function E(t){return"string"==typeof t&&t.trim().length>0?t.trim():void 0}function I(t){const e=String(t.operation_type||t.type||"").trim()
return l.has(e)}function f(t,e,n){if("STOCK_PURCHASE_BATCH"===t){const t=Array.isArray(n.lines)?n.lines.filter(p).map(t=>f("STOCK_PURCHASE","STOCK_PURCHASE",t)):[]
return{...n,lines:t}}if("ADJUST_STOCK"===t){const t=String(n.movementType??n.adjustmentType??e).toLowerCase(),r=m(n.quantityDelta??n.quantity_delta,0),a=n.nextStock??n.stockAfter??n.stock_after,o=t.includes("damage")||"STOCK_DAMAGE"===e
return{...n,adjustmentType:o?"damage":"correction",productId:n.productId??n.product_id,localProductId:n.localProductId??n.local_product_id,quantity:o?Math.abs(m(n.syncQuantityBase??n.quantityBase??n.quantity??r,r)):n.quantity,enteredUnit:n.syncEnteredUnit??n.enteredUnit??n.unit,newStockBaseQty:o?n.newStockBaseQty:m(n.newStockBaseQty??a,m(a,0)),note:n.note??n.reason}}if("STOCK_PURCHASE"===t||"STOCK_SALE"===t){const e="STOCK_PURCHASE"===t?S(n):{}
return{...n,...e,productId:n.productId??n.product_id,localProductId:n.localProductId??n.local_product_id,quantity:Math.abs(m(n.syncQuantityBase??n.quantityBase??n.quantity??n.quantityDelta??n.quantity_delta,0)),enteredUnit:n.syncEnteredUnit??n.enteredUnit??n.unit,note:n.note??n.reason}}return n}function S(t){const e=r(m(t.billAmount??t.bill_amount??t.purchaseBillAmount??t.purchase_bill_amount,0)),n=((...t)=>{for(const e of t){if(""===e||null==e)continue
const t=Number(e)
if(Number.isFinite(t))return t}})(t.purchasePaidAmount,t.purchase_paid_amount,t.paidAmount,t.paid_amount),a=String(t.purchasePaymentStatus??t.purchase_payment_status??"").toLowerCase(),o=r(Math.max(0,Math.min(n??("paid"===a?e:0),e>0?e:Number.MAX_SAFE_INTEGER))),i=r(Math.max(0,e-o)),s=e>0&&o>=e-.01?"paid":o>0?"partial":"due",c=(t=>{if("string"!=typeof t)return
const e=t.trim()
if(!e)return
const n=e.match(/^(\d{4}-\d{2}-\d{2})/)
if(n)return n[1]
const r=new Date(e)
return Number.isNaN(r.getTime())?void 0:r.toISOString().slice(0,10)})(t.purchaseDueDate??t.purchase_due_date)
return{purchasePaymentStatus:s,purchase_payment_status:s,purchasePaidAmount:o,purchase_paid_amount:o,purchaseDueAmount:i,purchase_due_amount:i,purchasePaymentMode:o>0?t.purchasePaymentMode??t.purchase_payment_mode:void 0,purchase_payment_mode:o>0?t.purchasePaymentMode??t.purchase_payment_mode:void 0,purchaseDueDate:i>0?c:void 0,purchase_due_date:i>0?c:void 0}}function R(t){const e=E(t)
if(e)return e}function T(t){return p(t)&&"credit"===String(t.mode??"").toLowerCase()}function A(t,e){if(I(t))return null
const n=String(t.operation_type||t.type||"").trim(),a=(t=>{const e=String(t.operation_type||t.type||"").trim()
return _[e]??e})(t)
let o=p(e)?e:{}
return"CREATE_BILL"===a&&(o=(t=>{const e=t.paymentBreakdown??t.payment_breakdown,n=Array.isArray(e)?e.filter(p):Array.isArray(t.payments)?t.payments.filter(p):[],a=n.filter(t=>!T(t)),o=n.filter(T),i=r(a.reduce((t,e)=>t+m(e.amount,0),0)),s=r(m(t.creditAmount??t.credit_amount,o.reduce((t,e)=>t+m(e.amount,0),0))),c=m(t.actualAmount??t.grandTotal??t.grand_total??t.totalAmount??t.total_amount,i+s)
return{...t,payments:a,tenderPayments:a,tender_payments:a,paymentBreakdown:n,payment_breakdown:n,creditPayments:o,credit_payments:o,paidAmount:i,paid_amount:i,buyerPaidAmount:i,buyer_paid_amount:i,creditAmount:s,credit_amount:s,dueAmount:r(Math.max(0,c-i)),due_amount:r(Math.max(0,c-i)),paymentStatus:s>0?i>0?"partial":"credit":"paid",payment_status:s>0?i>0?"partial":"credit":"paid"}})(o)),"UDHAR_PAYMENT"===a&&(o=(t=>{const e=p(t.payment)?t.payment:{},n=E(t.paymentId)??E(t.payment_id)??E(e.paymentId)??E(e.payment_id),r=E(t.localPaymentId)??E(t.local_payment_id)??E(e.localPaymentId)??E(e.local_payment_id)??n,a=E(t.clientPaymentId)??E(t.client_payment_id)??E(e.clientPaymentId)??E(e.client_payment_id)??r,o=E(t.ledgerEntryId)??E(t.ledger_entry_id)??E(e.ledgerEntryId)??E(e.ledger_entry_id),i=E(t.localLedgerEntryId)??E(t.local_ledger_entry_id)??E(e.localLedgerEntryId)??E(e.local_ledger_entry_id)??o,s=E(t.clientLedgerId)??E(t.client_ledger_id)??E(e.clientLedgerId)??E(e.client_ledger_id)??i??o??a,c=E(t.idempotencyKey)??E(t.idempotency_key)??E(e.idempotencyKey)??E(e.idempotency_key),d=E(t.sourceDeviceId)??E(t.source_device_id)??E(e.sourceDeviceId)??E(e.source_device_id)
return{...t,customerId:t.customerId??t.customer_id,localCustomerId:t.localCustomerId??t.local_customer_id,...n?{paymentId:n,payment_id:n}:{},...r?{localPaymentId:r,local_payment_id:r}:{},...a?{clientPaymentId:a,client_payment_id:a}:{},...o?{ledgerEntryId:o,ledger_entry_id:o}:{},...i?{localLedgerEntryId:i,local_ledger_entry_id:i}:{},...s?{clientLedgerId:s,client_ledger_id:s}:{},...c?{idempotencyKey:c,idempotency_key:c}:{},...d?{sourceDeviceId:d,source_device_id:d}:{},amount:t.amount??e.amount,mode:t.mode??e.mode,note:t.note??e.note,payment:{...e,...n?{paymentId:n,payment_id:n}:{},...r?{localPaymentId:r,local_payment_id:r}:{},...a?{clientPaymentId:a,client_payment_id:a}:{},...o?{ledgerEntryId:o,ledger_entry_id:o}:{},...i?{localLedgerEntryId:i,local_ledger_entry_id:i}:{},...s?{clientLedgerId:s,client_ledger_id:s}:{},...c?{idempotencyKey:c,idempotency_key:c}:{},...d?{sourceDeviceId:d,source_device_id:d}:{},amount:t.amount??e.amount,mode:t.mode??e.mode,note:t.note??e.note}}})(o)),"UPDATE_PURCHASE_BILL"!==a&&"DELETE_PURCHASE_BILL"!==a&&"RECORD_SUPPLIER_PAYMENT"!==a||(o=((t,e)=>{const n=S(e),r=R(e.localPurchaseHistoryId)??R(e.local_purchase_history_id)??R(e.localPurchaseBillId)??R(e.local_purchase_bill_id)??R(t.entity_id),a=R(e.purchaseHistoryId)??R(e.purchase_history_id)??R(e.purchaseBillId)??R(e.purchase_bill_id)??R(e.serverId)??R(e.server_id)??void 0,o=R(e.localMovementId)??R(e.local_movement_id)??R(e.localInventoryMovementId)??R(e.local_inventory_movement_id)??R(e.movementId)??R(e.movement_id),i=R(e.stockLedgerId)??R(e.stock_ledger_id)??R(e.inventoryMovementId)??R(e.inventory_movement_id)
return{...e,...n,purchaseHistoryId:a,purchase_history_id:a,purchaseBillId:R(e.purchaseBillId)??R(e.purchase_bill_id)??a,purchase_bill_id:R(e.purchaseBillId)??R(e.purchase_bill_id)??a,localPurchaseHistoryId:r,local_purchase_history_id:r,localPurchaseBillId:R(e.localPurchaseBillId)??R(e.local_purchase_bill_id)??r,local_purchase_bill_id:R(e.localPurchaseBillId)??R(e.local_purchase_bill_id)??r,stockLedgerId:i,stock_ledger_id:i,inventoryMovementId:R(e.inventoryMovementId)??R(e.inventory_movement_id)??i,inventory_movement_id:R(e.inventoryMovementId)??R(e.inventory_movement_id)??i,localMovementId:o,local_movement_id:o,productId:R(e.productId)??R(e.product_id),product_id:R(e.productId)??R(e.product_id),supplierId:R(e.supplierId)??R(e.supplier_id),supplier_id:R(e.supplierId)??R(e.supplier_id),supplierName:R(e.supplierName)??R(e.supplier_name)??null,supplier_name:R(e.supplierName)??R(e.supplier_name)??null,invoiceNumber:R(e.invoiceNumber)??R(e.invoice_number)??null,invoice_number:R(e.invoiceNumber)??R(e.invoice_number)??null,purchasePaymentMode:n.purchasePaidAmount&&Number(n.purchasePaidAmount)>0?R(e.purchasePaymentMode)??R(e.purchase_payment_mode)??"cash":null,purchase_payment_mode:n.purchasePaidAmount&&Number(n.purchasePaidAmount)>0?R(e.purchasePaymentMode)??R(e.purchase_payment_mode)??"cash":null}})(t,o)),o=((t,e)=>["CANCEL_BILL","RESTORE_BILL","DELETE_BILL","RESTORE_DELETED_BILL"].includes(t)?{...e,billId:e.serverBillId??e.billId??e.localBillId??e.id,localBillId:e.localBillId??e.billId??e.id,reason:e.reason??("RESTORE_BILL"===t||"RESTORE_DELETED_BILL"===t?"Offline restore sync":"Offline bill lifecycle sync")}:e)(a,o),o=((t,e)=>"DELETE_PRODUCT"!==t&&"RESTORE_PRODUCT"!==t?e:{...e,productId:e.serverProductId??e.productId??e.localProductId??e.id,localProductId:e.localProductId??e.productId??e.id,reason:e.reason??("RESTORE_PRODUCT"===t?"Offline product restore sync":"Offline product delete sync")})(a,o),o=((t,e)=>{if("BIND_PRODUCT_BARCODE"!==t)return e
const n=e.serverProductId??e.productId??e.localProductId??e.id
return{...e,productId:n,localProductId:e.localProductId??e.productId??e.id,barcode:"string"==typeof e.barcode?e.barcode.trim():e.barcode}})(a,o),o=((t,e)=>"DELETE_CUSTOMER"!==t&&"RESTORE_CUSTOMER"!==t?e:{...e,customerId:e.serverCustomerId??e.customerId??e.localCustomerId??e.id,localCustomerId:e.localCustomerId??e.customerId??e.id,reason:e.reason??("RESTORE_CUSTOMER"===t?"Offline customer restore sync":"Offline customer delete sync")})(a,o),"CREATE_LEDGER_ADJUSTMENT"!==a&&"REVERSE_UDHAR_PAYMENT"!==a||(o=(t=>({...t,ledgerEntryId:t.ledgerEntryId??t.ledger_entry_id??t.correctionId??t.id,customerId:t.customerId??t.customer_id,localCustomerId:t.localCustomerId??t.local_customer_id,amount:t.amount,note:t.note??t.reason,ownerPin:t.ownerPin}))(o)),o=f(a,n,o),{type:a,operation_type:a,entity_type:y[a]??t.entity_type,payload:o}}async function C(e){const r=u(e.entity_type)
if(!r||"settings"===r)return
const a=t.table(r),o=E(e.entity_id)??E(e.payload?.id)
if(!o)return
const i=await a.get(o).catch(()=>{})
i&&n(i)&&await a.put({...i,sync_status:"synced",updated_at:E(i.updated_at)??(new Date).toISOString()})}async function h(){if(await t.open(),!t.sync_outbox||"function"!=typeof t.sync_outbox.where)return 0
const n=e(),r=await t.sync_outbox.where("[tenant_id+store_id]").equals([n.tenant_id,n.store_id]).filter(t=>"SYNCED"!==t.status&&I(t)).toArray()
if(0===r.length)return 0
const a=(new Date).toISOString()
return await t.transaction("rw",[t.sync_outbox,t.local_audit_logs,t.subscription_cache,t.device_license_cache,t.staff_users,t.settings],async()=>{for(const e of r)await C(e).catch(()=>{}),await t.sync_outbox.put({...e,status:"SYNCED",sync_status:"synced",error_message:null,last_error:null,next_retry_at:null,last_attempt_at:a})}),r.length}function L(t){return"object"==typeof t&&null!==t&&!Array.isArray(t)}function P(t){return"string"==typeof t&&t.trim().length>0?t.trim():"number"==typeof t&&Number.isFinite(t)?String(t):void 0}function g(t,e){if(L(t))for(const n of e){const e=P(t[n])
if(e)return e}}function D(t,e){const n=P(e)
n&&t.add(n)}function b(t){return"SYNCED"===t.status||"synced"===t.sync_status}function w(t){return"FAILED"===t.status||"failed"===t.sync_status}function N(t){return"CONFLICT"===t.status||"conflict"===t.sync_status}function v(t){return"PENDING"===t.status||"SYNCING"===t.status||"pending_sync"===t.sync_status||"syncing"===t.sync_status}function O(t){const e=String(t.operation_type||t.type||"").toUpperCase()
return"bill"===String(t.entity_type||"").toLowerCase()||e.includes("BILL")}function U(t){const e=new Set
return["id","local_id","localId","server_id","serverId","merged_into_id","mergedIntoId","billId","bill_id","localBillId","local_bill_id","serverBillId","server_bill_id","clientBillId","client_bill_id","idempotency_key","idempotencyKey"].forEach(n=>D(e,t[n])),e}function B(t){const e=new Set
D(e,t.entity_id),D(e,t.clientEventId),D(e,t.op_id),D(e,t.idempotency_key)
const n=L(t.payload)?t.payload:{};["id","billId","bill_id","localBillId","local_bill_id","clientBillId","client_bill_id","serverBillId","server_bill_id","clientBillId","client_bill_id","idempotency_key","idempotencyKey"].forEach(t=>D(e,n[t]))
const r=n.bill
return L(r)&&["id","billId","bill_id","localBillId","local_bill_id","clientBillId","client_bill_id","serverBillId","server_bill_id","clientBillId","client_bill_id","idempotency_key","idempotencyKey"].forEach(t=>D(e,r[t])),e}function M(t,e){return t.map(t=>{const n=((t,e)=>{const n=o(e).filter(e=>!b(e)&&((t,e)=>!!O(t)&&((t,e)=>{for(const n of t)if(e.has(n))return!0
return!1})(B(t),U(e)))(e,t))
return n.some(N)?"conflict":n.some(w)?"failed":n.some(t=>"SYNCING"===t.status||"syncing"===t.sync_status)?"syncing":n.some(v)?"pending_sync":String(t.sync_status??t.status??"synced")})(t,e),r="synced"===n
return{...t,sync_status:n,isSynced:r,is_synced:r}})}async function x(e){const r=[...B(e)]
for(const a of r){const e=await t.bills.get(a).catch(()=>{})
if(e&&n(e))return e}for(const a of r){const e=await t.bills.where("local_id").equals(a).first().catch(()=>{})
if(e&&n(e))return e
const r=await t.bills.where("server_id").equals(a).first().catch(()=>{})
if(r&&n(r))return r}}async function H(e,r){if(g(r,["server_id","serverId"]))return!0
if("synced"===String(r.sync_status??"")&&g(r,["id"]))return!0
const a=[...B(e),...U(r)]
for(const o of a){const e=await t.id_mappings.get(o).catch(()=>{})
if(e&&n(e))return!0}return!1}function k(t){const e=String(t.error_message??t.last_error??"").toLowerCase()
return e.includes("constrainterror")||e.includes("key already exists")}function K(t){return String(t.error_message??t.last_error??"").toLowerCase()}function G(t){return String(t.operation_type||t.type||"").toUpperCase()}function q(t){return L(t.payload)?t.payload:{}}function Y(t,e){if(L(t))for(const n of e){const e=Number(t[n])
if(Number.isFinite(e))return e}}function F(t,e){const n=Y(t,e)
return"number"==typeof n&&r(n)>0}function V(t){return!!L(t)&&(!!F(t,["creditAmount","credit_amount","udharAmount","udhar_amount","dueAmount","due_amount"])||[t.payments,t.creditPayments,t.credit_payments].some(t=>!!Array.isArray(t)&&t.some(t=>{if(!L(t))return!1
const e=g(t,["mode","paymentMode","payment_mode"])?.toLowerCase()
return"credit"===e&&F(t,["amount","creditAmount","credit_amount"])})))}function J(t){const e=String(t.error_message??t.message??"").toLowerCase(),n=g(t,["source_event_id","sourceEventId"])
if("bill"!==String(t.entity_type??t.entityType??"").toLowerCase()||!n||!e.includes("include every guest order line before settling the table"))return!1
const r=L(t.local_snapshot)?t.local_snapshot:{},a=L(r.payload)?r.payload:r,o=L(a.bill)?a.bill:a,i=Array.isArray(o.items)?o.items.filter(L):[],s=i.some(t=>g(t,["guestOrderId"])&&g(t,["guestOrderLineId"])),c=i.some(t=>!g(t,["guestOrderId"])&&!g(t,["guestOrderLineId"])),d=i.some(t=>Boolean(g(t,["guestOrderId"]))!==Boolean(g(t,["guestOrderLineId"])))
return s&&c&&!d}function Q(t){const e=G(t),n=String(t.original_operation_type??"").toUpperCase()
if("CANCEL_BILL"!==e&&"RESTORE_BILL"!==e&&"SOFT_DELETE_BILL_PENDING"!==n||!N(t)&&!w(t))return!1
const r=K(t),a=r.includes("serverbillid"),o=r.includes("received")&&r.includes("null")
return a||o&&r.includes("invalid_type")}function j(t,e){const n=Number(t.repair_requeues??0)
return n>=3?null:{...t,status:"PENDING",sync_status:"pending_sync",error_message:null,last_error:null,next_retry_at:null,last_attempt_at:e,retry_count:0,attempts:0,repair_requeues:n+1}}function W(t){if(!t)return!1
if(g(t,["server_id","serverId"]))return!0
if("synced"===String(t.sync_status??"").toLowerCase())return!0
const e=g(t,["id"])
return Boolean(e&&!e.toLowerCase().includes("pending")&&!e.toLowerCase().startsWith("local_")&&!e.toLowerCase().startsWith("tmp_"))}async function X(e){const a=G(e)
if(!k(e))return!1
if("CREATE_BILL"===a){const t=await x(e)
return Boolean(t&&await H(e,t))}return a.includes("PAYMENT")||"payment"===String(e.entity_type).toLowerCase()?Boolean(await(async e=>{const a=q(e),o=L(a.payment)?a.payment:a,i=Y(o,["amount","paidAmount","paid_amount"]),s=g(o,["mode","paymentMode","payment_mode"])?.toLowerCase(),c=g(o,["customer_id","customerId"])??g(a,["customer_id","customerId"])
return(await t.payments.filter(n).toArray().catch(()=>[])).find(t=>{if(!W(t))return!1
const e=g(t,["mode","paymentMode","payment_mode"])?.toLowerCase(),n=Y(t,["amount","paidAmount","paid_amount"]),a=g(t,["customer_id","customerId"]),o=!s||!e||s===e,d=void 0===i||void 0===n||Math.abs(r(i)-r(n))<.005
return o&&d&&(!c||!a||c===a)})})(e)):!!(a.includes("STOCK")||a.includes("INVENTORY")||String(e.entity_type).toLowerCase().includes("inventory"))&&Boolean(await(async e=>{const a=q(e),o=g(a,["product_id","productId"]),i=Y(a,["quantity","qty","stockBaseQty","stock_base_qty"])
return(await t.inventory_movements.filter(n).toArray().catch(()=>[])).find(t=>{if(!W(t))return!1
const e=g(t,["product_id","productId"]),n=Y(t,["quantity","qty","stockBaseQty","stock_base_qty"]),a=!o||!e||o===e,s=void 0===i||void 0===n||Math.abs(r(i)-r(n))<.005
return a&&s})})(e))}async function Z(){await t.open()
const e=o(await i.getAll("sync_outbox").catch(()=>[])).filter(t=>(t=>{const e=K(t)
return O(t)&&"CREATE_BILL"===G(t)&&(N(t)||w(t))&&(t=>{const e=q(t)
return V(e)||V(e.bill)})(t)&&e.includes("at least one")&&e.includes("payment")})(t))
if(0===e.length)return 0
const n=s()
let r=0
for(const a of e){const e=j(a,n)
e&&(await t.sync_outbox.put(e),r+=1)}return r}async function z(){await t.open()
const e=o(await i.getAll("sync_outbox").catch(()=>[])),n=Date.now()
let r=0
for(const a of e){if(!w(a))continue
if((a.retry_count??a.attempts??0)>=d)continue
const e=a.next_retry_at?new Date(a.next_retry_at).getTime():0
!Number.isFinite(e)||e<=n||(await t.sync_outbox.put({...a,next_retry_at:null}),r+=1)}return r>0&&"undefined"!=typeof window&&window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated",{detail:{reason:"reconnect-backoff-cleared",cleared:r}})),r}async function $(e={}){const n=await(async(e=!1)=>{const n=Date.now(),r=o(await i.getAll("sync_outbox").catch(()=>[])).filter(t=>{if(!(t=>"SYNCING"===t.status||"syncing"===t.sync_status)(t))return!1
const r=(t=>{const e=t.last_attempt_at??t.client_created_at
if("string"!=typeof e)return 0
const n=new Date(e).getTime()
return Number.isFinite(n)?n:0})(t)
return e||0===r||n-r>12e4})
if(0===r.length)return 0
let a=0
return await t.transaction("rw",t.sync_outbox,async()=>{for(const e of r)await t.sync_outbox.put({...e,status:"PENDING",sync_status:"pending_sync",error_message:null,last_error:null,next_retry_at:null}),a+=1}),a})(!0===e.recoverAbandonedSyncing).catch(()=>0),r=await Z().catch(()=>0),c=await(async()=>{await t.open()
const e=o(await i.getAll("sync_outbox").catch(()=>[])).filter(t=>(t=>{const e=G(t),n=String(t.entity_type||"").toLowerCase(),r=K(t)
return!(!("STOCK_PURCHASE"===e||"UPDATE_PURCHASE_BILL"===e||"DELETE_PURCHASE_BILL"===e||"purchase_history"===n||n.includes("inventory")&&r.includes("purchase"))||!N(t)&&!w(t))&&(r.includes("purchaseduedate")||r.includes("purchase due date")||r.includes("purchasepaidamount")||r.includes("partial purchase")||r.includes("purchasehistoryid")||r.includes("purchasebillid")||r.includes("stockledgerid")||r.includes("localpurchasehistoryid")||r.includes("localpurchasebillid")||r.includes("invalid_string")||r.includes("too_small"))})(t)||(t=>{const e=G(t),n=K(t),r=Y(q(t),["amount"])
return"CREATE_LEDGER_ADJUSTMENT"===e&&(N(t)||w(t))&&"number"==typeof r&&0!==r&&(n.includes("amount")||n.includes("too_small")||n.includes("greater than or equal to 0"))})(t))
if(0===e.length)return 0
const n=s()
let r=0
for(const a of e){const e=j(a,n)
if(!e)continue
const o=A(a,q(a))?.payload??a.payload
await t.sync_outbox.put({...e,payload:o}),r+=1}return r})().catch(()=>0),d=await(async()=>{await t.open()
const e=o(await i.getAll("sync_outbox").catch(()=>[])).filter(Q)
if(0===e.length)return 0
const n=s()
let r=0
for(const a of e){const e=j(a,n)
if(!e)continue
const o=A(a,q(a))?.payload??a.payload
await t.sync_outbox.put({...e,payload:o}),r+=1}return r})().catch(()=>0),u=await a().then(t=>t.total).catch(()=>0),l=await tt().catch(()=>0),_=await(async()=>{await t.open()
const e=o(await i.getAll("sync_outbox").catch(()=>[])).filter(t=>!b(t)&&w(t)&&k(t))
if(0===e.length)return 0
const n=s()
let r=0
for(const a of e)await X(a)&&(await t.sync_outbox.put({...a,status:"SYNCED",sync_status:"synced",error_message:null,last_error:null,next_retry_at:null,last_attempt_at:n}),r+=1)
return r})().catch(()=>0),y=n+r+c+d+u+l+_
return y>0&&"undefined"!=typeof window&&window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated")),y}async function tt(){await t.open()
const e=o(await i.getAll("sync_outbox").catch(()=>[])).filter(t=>!b(t)&&O(t)&&"CREATE_BILL"===String(t.operation_type||t.type||"").toUpperCase())
if(0===e.length)return 0
const n=s()
let r=0
return await t.transaction("rw",[t.sync_outbox,t.bills,t.id_mappings],async()=>{for(const a of e){const e=await x(a)
e&&await H(a,e)&&(await t.sync_outbox.put({...a,status:"SYNCED",sync_status:"synced",error_message:null,last_error:null,next_retry_at:null,last_attempt_at:n}),r+=1)}}),r>0&&"undefined"!=typeof window&&window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated")),r}async function et(){await $().catch(()=>0)
const t=o(await i.getAll("sync_outbox")),e=await i.getAll("sync_conflicts")
return c(t,o(e))}export{J as a,A as b,z as c,$ as d,Z as e,M as f,tt as g,I as i,et as r,h as s}
