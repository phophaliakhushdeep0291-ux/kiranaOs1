import{ak as e,aV as t,ar as n,aN as r,b2 as i,bH as a,J as o,a_ as s,T as l,bJ as c,bK as d,bL as u,bM as _,bN as p,X as y,M as m,Z as f,P as g,U as h}from"./index-Ci-XYli4.js"
import{i as b,t as v,e as I,g as w,f as A,h as S,U as N}from"./sync-types-B187FdZc.js"
function P(e){if(!e)return
const t=Object.fromEntries(Object.entries(e).filter(([,e])=>null===e||"string"==typeof e&&e.length>0))
return Object.keys(t).length>0?JSON.stringify(t):void 0}function k(t){return e("/sync/push",{method:"POST",body:JSON.stringify(t)})}function O(n){const r="string"==typeof n||"number"==typeof n||null==n?{cursor:n??null}:n
return e(`/sync/pull${t({since:r.since??"1970-01-01T00:00:00.000Z",cursor:r.cursor??void 0,cursors:P(r.cursors),afterSeq:r.afterSeq??void 0,limit:r.limit??500})}`,{method:"GET",background:r.background,timeoutMs:3e4})}function B(t={}){return e("/sync/status",{method:"GET",background:t.background})}function M(t={}){return e("/sync/diagnostics",{method:"GET",background:t.background})}function L(t={}){return e("/sync/retry",{method:"POST",body:JSON.stringify(t)})}function T(t,n={}){return e("/sync/ack",{method:"POST",body:JSON.stringify({server_seq:String(t)}),background:n.background})}function x(t={}){return e("/sync/devices",{method:"GET",background:t.background})}function E(t){return e("/sync/resolve-conflict",{method:"POST",body:JSON.stringify(t)})}function j(n={}){return e(`/sync/conflicts${t({status:n.status??"open",entity_type:n.entityType,limit:n.limit??50,cursor:n.cursor??void 0})}`,{method:"GET",background:n.background})}function C(t,n={}){return e("/sync/conflicts/report",{method:"POST",body:JSON.stringify(t),background:n.background})}const F=/ownerpin|pinhash|password|authorization|cookie|apikey|secret|token$/
function D(e){const t=(e=>e.toLowerCase().replace(/[^a-z0-9]/g,""))(e)
return"ownerpinprovided"!==t&&F.test(t)}function J(e){if(Array.isArray(e))return e.map(e=>J(e))
if("object"!=typeof e||null===e)return e
const t={}
for(const[n,r]of Object.entries(e))D(n)||(t[n]=J(r))
return t}function q(e){const t=J(e)
return"object"!=typeof t||null===t||Array.isArray(t)?null:t}async function $(e){const t=n(),a=r(),o=((e,t,n,r)=>{const i=r&&"object"==typeof r&&!Array.isArray(r)?r:null
return`conflict_${e}_${t}_${String(i?.updated_at??i?.updatedAt??i?.version??n)}`.replace(/[^a-zA-Z0-9_-]/g,"_")})(e.entityType,e.entityId,e.sourceId,e.localSnapshot),s=J(e.localSnapshot),l=J(e.serverSnapshot)
if(await i.sync_conflicts.put({id:o,entity_type:e.entityType,entity_id:e.entityId,tenant_id:t.tenant_id,store_id:t.store_id,device_id:t.device_id,created_at:a,updated_at:a,deleted_at:null,version:1,sync_status:"conflict",last_modified_by:null,resolution:"unresolved",local_snapshot:s??null,server_snapshot:l??null,error_message:e.errorMessage??"Sync conflict",source_event_id:e.sourceId,server_conflict_id:e.serverConflictId,server_record_version:e.serverRecordVersion,server_version:e.serverVersion??e.sourceId}),!e.serverConflictId)try{C({client_conflict_id:o,entity_type:e.entityType,entity_id:e.entityId,reason_code:"CLIENT_SYNC_CONFLICT",message:e.errorMessage??"Sync conflict",local_snapshot:q(s),server_snapshot:q(l),server_version:e.sourceId},{background:!0}).then(async({conflict:t})=>{const n=await i.sync_conflicts.get(o)
n&&await i.sync_conflicts.put({...n,server_conflict_id:t.id,server_version:t.server_version??e.sourceId,updated_at:r()})}).catch(()=>{})}catch{}}function z(e,t){return"string"==typeof e?t[e]??e:Array.isArray(e)?e.map(e=>z(e,t)):b(e)?Object.fromEntries(Object.entries(e).map(([e,n])=>[e,z(n,t)])):e}const H=new Set(["id","local_id","localId","paymentId","payment_id","clientPaymentId","client_payment_id","localBillId","local_bill_id","clientBillId","client_bill_id","localItemId","local_item_id","localPaymentId","local_payment_id","localCustomerId","local_customer_id","ledgerEntryId","ledger_entry_id","clientLedgerId","client_ledger_id","localLedgerEntryId","local_ledger_entry_id","localLedgerId","local_ledger_id","movementId","movement_id","clientMovementId","client_movement_id","localMovementId","local_movement_id","inventoryMovementId","inventory_movement_id","localInventoryMovementId","local_inventory_movement_id","purchaseHistoryId","purchase_history_id","purchaseBillId","purchase_bill_id","localPurchaseHistoryId","local_purchase_history_id","localPurchaseBillId","local_purchase_bill_id","localExpenseId","local_expense_id","local_items","local_payments","local_ledger_entries"])
function K(e,t,n=new Set){const r=new Set,i=e=>{if(!S(e)||t[e]||n.has(e)){if(Array.isArray(e))e.forEach(i)
else if(b(e))for(const[t,n]of Object.entries(e))H.has(t)||i(n)}else r.add(e)}
return i(e),[...r]}async function U(e,t,a){if(!t||!a||t===a)return
const o=n()
await i.id_mappings.put({local_id:t,server_id:a,entity_type:e,tenant_id:o.tenant_id,store_id:o.store_id,updated_at:r()})}const G={products:"product",product:"product",customers:"customer",customer:"customer",bills:"bill",bill:"bill",payments:"payment",payment:"payment",suppliers:"supplier",supplier:"supplier",purchaseHistory:"purchase_history",purchase_history:"purchase_history",purchaseBills:"purchase_bill",purchase_bills:"purchase_bill",ledgerEntries:"ledger_entry",ledger_entries:"ledger_entry",ledgerEntry:"ledger_entry",ledger_entry:"ledger_entry",customerLedger:"ledger_entry",customer_ledger:"ledger_entry",udharLedger:"ledger_entry",udhar_ledger:"ledger_entry",stockLedger:"stock_ledger",stock_ledger:"stock_ledger",inventoryMovements:"inventory_movement",inventory_movements:"inventory_movement",expenses:"expense",expense:"expense"}
function V(e){return G[e]??e}async function Z(e){if(!b(e))return 0
let t=0
for(const[n,r]of Object.entries(e)){if(!b(r))continue
const e=V(n)
for(const[n,i]of Object.entries(r))"string"==typeof n&&"string"==typeof i&&n&&i&&n!==i&&(await U(e,n,i),await re(e,n,i),t+=1)}return t}async function R(){const e=await o.getAll("id_mappings").catch(()=>[])
return Object.fromEntries(e.map(e=>[e.local_id,e.server_id]))}const W=new Set(["id","local_id","localId","server_id","serverId","clientEventId","op_id","opId","idempotency_key","idempotencyKey"])
function X(e,t,n){if(e===t)return n
if(Array.isArray(e))return e.map(e=>X(e,t,n))
if(!b(e))return e
let r=!1
const i={}
for(const[a,o]of Object.entries(e)){if(W.has(a)){i[a]=o
continue}const e=X(o,t,n)
e!==o&&(r=!0),i[a]=e}return r?i:e}async function Y(e,t){const n=["products","customers","bills","bill_items","payments","customer_ledger","inventory_movements","suppliers","purchase_bills","expenses","settings","sync_outbox"]
await i.transaction("rw",n.map(e=>i.table(e)),async()=>{for(const r of n){const n=i.table(r)
n&&"function"==typeof n.filter&&await n.filter(a).modify(n=>{const r=X(n,e,t)
b(r)&&Object.assign(n,r)})}})}function Q(e,t,n=0){for(const r of t){const t=Number(e[r]??void 0)
if(Number.isFinite(t))return Math.round(100*(t+Number.EPSILON))/100}return n}function ee(e,t){return Array.isArray(e)?Math.round(100*(e.reduce((e,n)=>{if(!b(n))return e
if("credit"===String(n.mode??"").toLowerCase()!==t)return e
const r=Number(n.amount??0)
return Number.isFinite(r)?e+r:e},0)+Number.EPSILON))/100:0}function te(e,t,i,a){const o=n(),s=r(),l=t.created_at??t.createdAt??e.created_at??e.createdAt??s,c=t.updated_at??t.updatedAt??s,d=e.merged_into_id??e.mergedIntoId,u="string"==typeof d?d:null
return((e,t,n)=>{const r=Q(e,["creditAmount","credit_amount","dueAmount","due_amount"],ee(e.payments,!0))
if(r<=0)return n
const i=Q(e,["paidAmount","paid_amount","buyerPaidAmount","buyer_paid_amount"],ee(e.payments,!1)),a=Q(n,["grandTotal","grand_total","totalAmount","total_amount","netAmount","net_amount","actualAmount","actual_amount"],i+r),o=Q(t,["creditAmount","credit_amount","dueAmount","due_amount"],ee(t.payments,!0)),s=Q(t,["paidAmount","paid_amount","buyerPaidAmount","buyer_paid_amount"],ee(t.payments,!1)),l=Array.isArray(t.payments)&&t.payments.some(e=>b(e)&&"credit"===String(e.mode??"").toLowerCase())
return o<=.009||s>=Math.max(0,a-.009)||l?{...n,paidAmount:i,paid_amount:i,buyerPaidAmount:i,buyer_paid_amount:i,creditAmount:r,credit_amount:r,dueAmount:Math.round(100*(Math.max(0,a-i)+Number.EPSILON))/100,due_amount:Math.round(100*(Math.max(0,a-i)+Number.EPSILON))/100,paymentStatus:r>0?i>0?"partial":"credit":"paid",payment_status:r>0?i>0?"partial":"credit":"paid",payments:Array.isArray(e.payments)?e.payments:n.payments}:n})(e,t,{...e,...t,id:i,local_id:a??("string"==typeof e.local_id?e.local_id:void 0),server_id:i,tenant_id:"string"==typeof t.tenant_id?t.tenant_id:"string"==typeof e.tenant_id?e.tenant_id:o.tenant_id,store_id:"string"==typeof t.store_id?t.store_id:"string"==typeof e.store_id?e.store_id:o.store_id,created_at:"string"==typeof l?l:s,updated_at:"string"==typeof c?c:s,deleted_at:"string"==typeof t.deleted_at||null===t.deleted_at?t.deleted_at:"string"==typeof e.deleted_at||null===e.deleted_at?e.deleted_at:null,version:A(t.version??t.server_version??e.version)||1,sync_status:"synced",last_modified_by:"string"==typeof t.last_modified_by||null===t.last_modified_by?t.last_modified_by:"string"==typeof e.last_modified_by||null===e.last_modified_by?e.last_modified_by:null,device_id:"string"==typeof e.device_id?e.device_id:o.device_id,merged_into_id:u===i?null:e.merged_into_id??null,mergedIntoId:u===i?null:e.mergedIntoId??null})}function ne(e,t,n){return"bills"!==e?t:{...t,sync_status:"synced",isSynced:!0,is_synced:!0,clientBillId:"string"==typeof t.clientBillId?t.clientBillId:"string"==typeof t.client_bill_id?t.client_bill_id:n,client_bill_id:"string"==typeof t.client_bill_id?t.client_bill_id:"string"==typeof t.clientBillId?t.clientBillId:n,localBillId:"string"==typeof t.localBillId?t.localBillId:"string"==typeof t.local_bill_id?t.local_bill_id:n,local_bill_id:"string"==typeof t.local_bill_id?t.local_bill_id:"string"==typeof t.localBillId?t.localBillId:n}}async function re(e,t,n,o){if(!n)return
const s=v(e)
if(!s||"settings"===s)return
await i.open()
const l=i.table(s),c=t?await l.get(t):void 0,d=await l.get(n),u=c&&a(c)?c:void 0,_=d&&a(d)?d:void 0
if(!u&&!_&&!o)return void(t&&t!==n&&await Y(t,n))
const p=ne(s,te(_??u??{},o??{},n,t),t)
if(await l.put(p),t&&t!==n&&u)if(new Set(["bills","bill_items","payments","customer_ledger","inventory_movements","purchase_bills","expenses"]).has(s)){const e=r()
await l.put({...u,server_id:n,merged_into_id:n,sync_status:"synced",isSynced:"bills"===s||u.isSynced,is_synced:"bills"===s||u.is_synced,deleted_at:e,deletedAt:e,updated_at:e,updatedAt:e})}else await l.delete(t)
t&&t!==n&&await Y(t,n)}async function ie(e,t,n){const r=I(e.operation_type,e.entity_type),o=v(r)
if(!o||"settings"===o)return
const s=n??e.entity_id,l=i.table(o),c=await l.get(s)??await l.get(e.entity_id),d=c&&a(c)?c:void 0
if(!d)return
const u=n&&n!==e.entity_id?e.entity_id:w(d,["local_id","localId"]),_=ne(o,te(d,t??{},s,u),u)
await l.put(_)}function ae(e){return"object"==typeof e&&null!==e&&!Array.isArray(e)}function oe(e,t,n=""){if(!ae(e))return n
for(const r of t){const t=e[r]
if("string"==typeof t&&t.trim().length>0)return t.trim()
if("number"==typeof t&&Number.isFinite(t))return String(t)}return n}function se(e,t,n=0){if(!ae(e))return n
for(const r of t){const t=Number(e[r])
if(Number.isFinite(t))return t}return n}function le(e){return String(e??"").trim().toLowerCase().replace(/\s+/g," ")}function ce(e){return l(se(e,["billAmount","bill_amount","purchaseBillAmount","purchase_bill_amount","grandTotal","grand_total","totalAmount","total_amount","amount"]))}function de(e){const t=se(e,["purchasePaidAmount","purchase_paid_amount","paidAmount","paid_amount"],NaN)
if(Number.isFinite(t))return l(Math.max(0,t))
const n=String(e.purchasePaymentStatus??e.purchase_payment_status??e.paymentStatus??e.payment_status??"paid").toLowerCase()
return"due"===n||"unpaid"===n||"pending"===n?0:ce(e)}function ue(e){const t=e.local_purchase_previous_keys??e.localPurchasePreviousKeys
return Array.isArray(t)?t.filter(e=>"string"==typeof e&&e.length>0):[]}function _e(e){return Boolean(e.local_purchase_override_at??e.localPurchaseOverrideAt??e.local_purchase_action??e.localPurchaseAction)}function pe(e){return"purchase"===String(e.action??e.type??"").toLowerCase()}function ye(e){const t=(e=>oe(e,["invoiceNumber","invoice_number","purchaseBillNo","purchase_bill_no","supplierBillNo","supplier_bill_no","billNo","bill_no"],"-"))(e),n=le(oe(e,["supplierId","supplier_id"])||oe(e,["supplierName","supplier_name"],"supplier")),r=le(oe(e,["productId","product_id"],"product")),i=le(t||"-"),a=ce(e).toFixed(2),o=de(e).toFixed(2),s=(e=>{const t=se(e,["purchaseDueAmount","purchase_due_amount","dueAmount","due_amount"],NaN)
return Number.isFinite(t)?l(Math.max(0,t)):l(Math.max(0,ce(e)-de(e)))})(e).toFixed(2),c=((e,t)=>{const n=(e=>oe(e,["createdAt","created_at","billDate","bill_date","updatedAt","updated_at"]))(e)
if(!n)return"no-date"
const r=new Date(n).getTime()
return Number.isFinite(r)?t&&"-"!==t?new Date(r).toISOString().slice(0,10):String(Math.floor(r/9e5)):n.slice(0,16)})(e,t)
return[...[oe(e,["id"]),oe(e,["server_id","serverId"]),oe(e,["local_id","localId"]),oe(e,["purchaseHistoryId","purchase_history_id"]),oe(e,["purchaseBillId","purchase_bill_id"]),oe(e,["localPurchaseHistoryId","local_purchase_history_id"]),oe(e,["localPurchaseBillId","local_purchase_bill_id"])].filter(Boolean).map(e=>`purchase-id:${le(e)}`),["purchase-stable",n,r,i,a,c].join("|"),["purchase-business",n,r,i,a,o,s,c].join("|"),...ue(e)]}function me(e,t,n){const r=(new Date).toISOString(),i=new Set([...ye(n??e),...ue(e)])
return{...e,local_purchase_action:t,localPurchaseAction:t,local_purchase_override_at:r,localPurchaseOverrideAt:r,local_purchase_previous_keys:[...i],localPurchasePreviousKeys:[...i],sync_status:"pending_sync"}}function fe(e,t){return 0!==t.keys.size&&ye(e).some(e=>t.keys.has(e))}async function ge(){const[e,t]=await Promise.all([o.getAll("purchase_bills").catch(()=>[]),o.getAll("inventory_movements").catch(()=>[])])
return(e=>{const t=new Set
for(const n of e)_e(n)&&ye(n).forEach(e=>t.add(e))
return{keys:t}})([...s(e),...s(t).filter(pe)])}const he=["id","server_id","serverId","clientProductId","client_product_id","local_id","localId"],be=["id","server_id","serverId","clientBillId","client_bill_id","localBillId","local_bill_id","local_id","localId"]
function ve(e,t){return new Set(e.flatMap(e=>t.map(t=>e[t]).filter(e=>"string"==typeof e&&e.length>0)))}async function Ie(e){const t=await i.id_mappings.where("server_id").equals(e).filter(a).first().catch(()=>{})
return t?.local_id}function we(e){const t=b(e.entity)?e.entity:void 0
return{...(b(e.payload)?e.payload:void 0)??{},...t??{}}}function Ae(e,t,n=0){for(const r of t){const t=Number(e[r])
if(Number.isFinite(t))return t}return n}function Se(e){return String(e.source_type??e.sourceType??e.type??"").trim().toLowerCase()}function Ne(e){return w(e,["source_id","sourceId","bill_id","billId","payment_id","paymentId","local_bill_id","localBillId"])}function Pe(e){return new Set([e.id,e.local_id,e.localId,e.server_id,e.serverId,e.source_id,e.sourceId,e.clientLedgerId,e.client_ledger_id,e.localLedgerEntryId,e.local_ledger_entry_id,e.ledgerEntryId,e.ledger_entry_id,e.paymentId,e.payment_id,e.localPaymentId,e.local_payment_id,e.clientPaymentId,e.client_payment_id,e.idempotencyKey,e.idempotency_key].filter(e=>"string"==typeof e&&e.length>0))}function ke(e){const t=Se(e)
return"payment"===String(e.type??"").trim().toLowerCase()||"payment"===t||"udhar_payment"===t}async function Oe(e){const t=String(e.entity_type??e.entityType??""),o=v(t)
if(!o)return"ignored"
if("settings"===o){const t=we(e),a=w(t,["key","id"])
return a?(await i.settings.put({key:a,value:t.value??t,tenant_id:n().tenant_id,store_id:n().store_id,updated_at:r(),expires_at:"number"==typeof t.expires_at?t.expires_at:null}),"merged"):"ignored"}const s=we(e),l=w(e,["entity_id","entityId","server_id","serverId","id"])??w(s,["server_id","serverId","id"])
if(!l)return"ignored"
const y=await Ie(l),m=w(s,["local_id","localId","localBillId","local_bill_id","clientBillId","client_bill_id","localProductId","local_product_id","clientProductId","client_product_id"])??y,f="payments"===o?await c(s):void 0,g="customer_ledger"===o?await(async(e,t)=>{const n=Se(e),r=ke(e),o="bill"===n||"debit"===n||"BILL"===String(e.type??"").toUpperCase()
if(!r&&!o)return
const s=Ne(e),l=s?await Ie(s):void 0,c=new Set([s,l].filter(e=>Boolean(e))),d=Pe(e),u=Math.abs(Ae(e,["amount"],0)),_=w(e,["customerId","customer_id"]),p=_?await Ie(_):void 0,y=new Set([_,p].filter(e=>Boolean(e)))
return(await i.customer_ledger.filter(a).toArray().catch(()=>[])).find(e=>{if(null!=e.deleted_at||null!=e.deletedAt)return!1
if(w(e,["id"])===t||w(e,["server_id","serverId"])===t)return!0
if(w(e,["server_id","serverId"]))return!1
const n=Se(e),i="bill"===n||"debit"===n||"BILL"===String(e.type??"").toUpperCase(),a=ke(e)
if(o&&!i)return!1
if(r&&!a)return!1
const s=Ne(e),l=Pe(e),_=[...d].some(e=>l.has(e))
if(o&&(!s||!c.has(s)))return!1
if(r&&!_)return!1
const p=Math.abs(Ae(e,["amount"],0))
if(Math.abs(p-u)>.005)return!1
const m=w(e,["customerId","customer_id"])
return 0===y.size||!m||y.has(m)})})(s,l):void 0,h=w(f??g??{},["id","local_id","localId"]),b=m??h,A=f??g??await(async(e,t,n)=>{const r=i.table(e),o=[t,n].filter(e=>"string"==typeof e&&e.length>0)
for(const i of o){const e=await r.get(i)
if(e&&a(e))return e}const s=await r.where("server_id").equals(t).filter(a).first().catch(()=>{})
if(s)return s
if(n){const e=await r.where("local_id").equals(n).filter(a).first().catch(()=>{})
if(e)return e}})(o,l,b)
if("delete"===String(e.operation_type??e.operationType??e.type??"").toLowerCase()||null!=e.deleted_at){if(A&&N.has(String(A.sync_status??"synced"))){await $({entityType:I("",t),entityId:w(A,["id"])??l,sourceId:w(e,["change_id"])??String(e.server_version??Date.now()),localSnapshot:A,serverSnapshot:null,errorMessage:"Server deleted an entity that has unsynced local changes"})
const n=i.table(o)
return await n.put({...A,sync_status:"conflict"}),"conflict"}if(A){const e=i.table(o),t=[w(A,["id"]),b,l].filter(e=>Boolean(e))
await e.bulkDelete([...new Set(t)])}return"merged"}const S="bills"!==o||null==A||d(A)||!d(s)||!u(A,s)&&(_(A)&&_(s)||!p(A,s))?void 0:A,P=w(f??g??S??{},["id","local_id","localId"]),k=b??P,O=null!=A&&N.has(String(A.sync_status??"synced"))&&!w(A,["server_id","serverId"])&&Boolean(b)&&w(A,["id","local_id","localId"])===b
if("purchase_bills"===o){const e={...s,id:l,server_id:l,local_id:b??m},n=await ge().catch(()=>({keys:new Set}))
if(A&&_e(A)||fe(e,n))return await U(I("",t),k??b,l),"ignored"}if(A&&!f&&!g&&!S&&!O&&N.has(String(A.sync_status??"synced"))){await $({entityType:I("",t),entityId:w(A,["id"])??l,sourceId:w(e,["change_id"])??String(e.server_version??e.version??Date.now()),localSnapshot:A,serverSnapshot:s,errorMessage:"Server changed an entity that has unsynced local changes"})
const n=i.table(o)
return await n.put({...A,sync_status:"conflict"}),"conflict"}return await U(I("",t),k,l),await re(t,k??l,l,s),"merged"}function Be(e){return new Set([e.id,e.local_id,e.localId,e.server_id,e.serverId].filter(e=>"string"==typeof e&&e.length>0))}function Me(e){const t=e.customerId??e.customer_id
return"string"==typeof t&&t.length>0?t:null}async function Le(){await(async()=>{if("function"!=typeof o.removeOrphans)return
const e=n(),[t,r]=await Promise.all([o.getAll("products"),o.getAll("bills")])
await Promise.all([o.removeOrphans("inventory_movements",ve(t,he),["product_id","productId"],e),o.removeOrphans("bill_items",ve(r,be),["bill_id","billId"],e),o.removeOrphans("payments",ve(r,be),["bill_id","billId"],e,{removeWhenForeignKeyMissing:!1})])})(),await(async()=>{const e=await o.getAll("customers").catch(()=>[]),t=g(await o.getAll("customer_ledger").catch(()=>[])),n=await o.getAll("id_mappings").catch(()=>[])
if(0===e.length||0===t.length)return
const a=i.customers,s=r()
for(const r of e){const e=Be(r)
let i=!0
for(;i;){i=!1
for(const t of n){const n=String(t.entity_type??t.entityType??"")
if(n&&"customer"!==n&&"customers"!==n)continue
const r=w(t,["local_id","localId"]),a=w(t,["server_id","serverId"])
r&&a&&(e.has(r)&&!e.has(a)&&(e.add(a),i=!0),e.has(a)&&!e.has(r)&&(e.add(r),i=!0))}}if(0===e.size)continue
const o=t.filter(t=>{if(null!=t.deleted_at||null!=t.deletedAt)return!1
const n=Me(t)
return!!n&&e.has(n)})
if(0===o.length)continue
const l=Math.max(0,Math.round(100*(h(o)+Number.EPSILON))/100),c=Number(r.udharAmount??r.totalUdhar??0)
Number.isFinite(c)&&Math.abs(c-l)<.005||await a.put({...r,type:l>0?"udhar":r.type??"regular",udharAmount:l,totalUdhar:l,udhar_amount:l,total_udhar:l,updatedAt:"string"==typeof r.updatedAt?r.updatedAt:s,updated_at:"string"==typeof r.updated_at?r.updated_at:s})}})().catch(()=>{})
const e=async(e,t=500)=>(await o.getAll(e).catch(()=>[])).filter(e=>null==e.deleted_at&&null==e.deletedAt).sort((e,t)=>String(t.updated_at??t.updatedAt??t.created_at??t.createdAt??"").localeCompare(String(e.updated_at??e.updatedAt??e.created_at??e.createdAt??""))).slice(0,t)
await Promise.all([e("products",1e3).then(e=>y("products",e,30)),e("customers",1e3).then(e=>y("customers",e,30)),e("bills",500).then(e=>y("bills",m(e),30)),e("payments",1e3).then(e=>y("payments",f(e),30)),e("customer_ledger",1e3).then(e=>y("customer_ledger",g(e),30)),e("suppliers",500).then(e=>y("suppliers",e,30)),e("inventory_movements",1e3).then(e=>y("inventory_movements",e,30)),e("purchase_bills",1e3).then(e=>y("purchase_bills",e,30))])}export{T as a,k as b,Z as c,z as d,K as e,re as f,ie as g,$ as h,ge as i,fe as j,M as k,R as l,Oe as m,C as n,E as o,U as p,B as q,Le as r,O as s,x as t,J as u,D as v,j as w,L as x,me as y}
