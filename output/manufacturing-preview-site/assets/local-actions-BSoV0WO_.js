import{a8 as t,J as e,T as n,a6 as i,au as a,av as l,ax as o,Y as r,aw as d,N as s,at as c,X as u,a9 as _}from"./index-Ci-XYli4.js"
const p="bills"
function y(t){return"object"==typeof t&&null!==t&&!Array.isArray(t)}function m(t){return String(t.billNumber??t.billNo??t.id??"bill")}function b(t){const e=t.customerId??t.customer_id
return"string"==typeof e&&e.length>0?e:null}function f(t){const e=i(t.creditAmount??t.credit_amount,Number.NaN)
if(Number.isFinite(e))return Math.max(0,n(e))
const a=i(t.grandTotal??t.grand_total??t.totalAmount??t.total_amount??t.netAmount??t.net_amount,0),l=(Array.isArray(t.payments)?t.payments.filter(y):[]).reduce((t,e)=>"credit"===String(e.mode??"").toLowerCase()?t:t+Math.max(0,i(e.amount,0)),0),o=i(t.paidAmount??t.paid_amount??t.buyerPaidAmount??t.buyer_paid_amount,l)
return Math.max(0,n(a-Math.max(l,o)))}function w(t,e,n=""){return`${t}_${String(e.local_id??e.localId??e.clientBillId??e.client_bill_id??e.id??"bill").replace(/[^a-zA-Z0-9_-]/g,"_")}${n}`}async function g(t){return(await e.getAll("bills").catch(()=>[])).find(e=>e.id===t||e.local_id===t||e.server_id===t||e.billNo===t||e.billNumber===t)||s(p,[]).find(e=>e.id===t||e.billNo===t||e.billNumber===t)}function h(t,e,n,i,l){const o="cancel_bill"===t?"bill_cancelled":"soft_delete_bill"===t?"bill_soft_deleted":"restore_bill"===t?"bill_restored":t
return a({action:o,entityType:"bill",entityId:e.id,entityLabel:m(e),oldValue:l??null,newValue:e,reason:i,ownerPinProvided:n.length>0,summary:`${o.replaceAll("_"," ")} ${m(e)}`})}function I(t){const e=s(p,[]).map(e=>e.id===t.id?{...e,...t}:e)
e.some(e=>e.id===t.id)||e.unshift(t),u(p,e,30),o(p,t,500)}function v(t){const e=i(t.quantityInBaseUnit??t.quantity_in_base_unit,Number.NaN)
if(Number.isFinite(e)&&0!==e)return Math.abs(n(e))
const a=Math.abs(i(t.quantity,0)),l=i(t.conversionToBase??t.conversion_to_base,1)
return n(a*(l>0?l:1))}async function A(u,p,h){t(_,{action:"cancel_bill",ownerPin:p,entityId:u,reason:h})
const A=await g(u)
if(!A)throw new Error("Bill not found in local records")
if("cancelled"===String(A.status).toLowerCase())return A
if("sales_return"===String(A.billType).toLowerCase())throw new Error("A completed sale return cannot be cancelled from the bill screen")
if((await e.getAll("bills").catch(()=>[])).some(t=>"sales_return"===String(t.billType).toLowerCase()&&"cancelled"!==String(t.status).toLowerCase()&&(t.returnOfBillId===A.id||t.return_of_bill_id===A.id)))throw new Error("This bill has completed returns and can no longer be cancelled")
const N=(new Date).toISOString(),P={...A,status:"cancelled",cancelledAt:N,cancelled_at:N,cancelledReason:h?.trim()||null,cancelReason:h?.trim()||null,updatedAt:N,updated_at:N,sync_status:"pending_sync",isSynced:!1,is_synced:!1},{products:S,movements:B}=await(async(t,a)=>{const l=await(async t=>{const n=Array.isArray(t.items)?t.items.filter(y):[]
if(n.length>0)return n
const i=new Set([t.id,t.local_id,t.server_id,t.clientBillId,t.client_bill_id].filter(t=>"string"==typeof t&&t.length>0))
return(await e.getAll("bill_items").catch(()=>[])).filter(t=>{const e=t.billId??t.bill_id??t.localBillId??t.local_bill_id
return"string"==typeof e&&i.has(e)})})(t),o=new Set(l.map(t=>t.productId??t.product_id).filter(t=>"string"==typeof t&&t.length>0))
if(0===o.size)return{products:[],movements:[]}
const r=await e.getAll("products").catch(()=>[]),d=s("products",[]),u=new Map
for(const e of[...r,...d])o.has(e.id)&&!u.has(e.id)&&u.set(e.id,e)
const _=new Map,p=new Map,b=[]
for(const[e,s]of l.entries()){const l=s.productId??s.product_id
if(!l)continue
const o=u.get(l)
if(!o)continue
const r=v(s)
if(!(r>0))continue
const d=_.has(l)?_.get(l):i(o.stockBaseQty??o.stockQuantity,0),y=n(d+r)
_.set(l,y)
const f=s.sellingUnitId??s.selling_unit_id
if("per_pack"===o.packagingMode&&f){const t=o.sellingUnits?.find(t=>t.id===f)
if(t){const e=`${l}:${f}`,a=p.has(e)?p.get(e):i(t.onHandQty,0)
p.set(e,n(a+Math.abs(i(s.quantity,0))))}}b.push(c({id:w("stock_cancel",t,`_${e}`),productId:l,product_id:l,productName:o.name??s.name??"Product",product_name:o.name??s.name??"Product",type:"cancel_reversal",action:"cancel_reversal",quantityDelta:r,quantity_delta:r,stockBefore:d,stock_before:d,stockAfter:y,stock_after:y,reference_type:"bill",reference_id:t.id,billId:t.id,bill_id:t.id,note:`Cancelled ${m(t)}`,createdAt:a},"inventory_movement","pending_sync"))}return{products:[...u.values()].filter(t=>_.has(t.id)).map(e=>{const n=_.get(e.id),i="per_pack"===e.packagingMode?e.sellingUnits?.map(t=>{if(!t.id)return t
const n=p.get(`${e.id}:${t.id}`)
return void 0===n?t:{...t,onHandQty:n}}):e.sellingUnits
return{...e,sellingUnits:i,stockBaseQty:n,stockQuantity:n,updatedAt:a,updated_at:a,sync_status:"pending_sync",negativeStockWarning:n<0?`Stock remains negative after cancelling ${m(t)}.`:void 0,stockNeedsReview:n<0}}),movements:b}})(P,N),k=((t,e,n)=>{const i=f(t),a=b(t)
return i<=0||!a?null:c({id:w("ledger_cancel",t),customerId:a,customer_id:a,customerName:t.customerName??t.customer_name??null,type:"bill_cancel_correction",source_type:"bill",source_id:t.id,billId:t.id,bill_id:t.id,amount:-Math.abs(i),note:e||`Cancelled ${m(t)}`,entry_at:n,createdAt:n,created_at:n},"ledger_entry","pending_sync")})(P,h,N),x=b(P),M=f(P),$=k&&x?(await e.getAll("customers").catch(()=>[])).find(t=>t.id===x||t.local_id===x||t.server_id===x):void 0,O=$&&k?{...$,udharAmount:Math.max(0,n(i($.udharAmount??$.udhar_amount??$.totalUdhar??$.total_udhar,0)-M)),udhar_amount:Math.max(0,n(i($.udharAmount??$.udhar_amount??$.totalUdhar??$.total_udhar,0)-M)),totalUdhar:Math.max(0,n(i($.udharAmount??$.udhar_amount??$.totalUdhar??$.total_udhar,0)-M)),total_udhar:Math.max(0,n(i($.udharAmount??$.udhar_amount??$.totalUdhar??$.total_udhar,0)-M)),updatedAt:N,updated_at:N,sync_status:"pending_sync"}:null,L=a({action:"bill_cancelled",entityType:"bill",entityId:P.id,entityLabel:m(P),oldValue:A,newValue:P,reason:h,ownerPinProvided:!0,summary:`bill cancelled ${m(P)}`}),E=l({entity_type:"bill",entity_id:P.id,operation_type:"CANCEL_BILL_PENDING",idempotency_key:`cancel-bill:${P.local_id??P.id}`,payload:{billId:P.id,localBillId:P.local_id??P.id,serverBillId:P.server_id??null,reason:h??null,ownerPin:p,ownerPinProvided:!0}}),q=l(d(L))
await e.transaction(["bills","products","inventory_movements","customers","customer_ledger","local_audit_logs","sync_outbox"],async t=>{await t.put("bills",P),await t.putMany("products",S),await t.putMany("inventory_movements",B),O&&await t.put("customers",O),k&&await t.put("customer_ledger",k),await t.put("local_audit_logs",L),await t.enqueueOutboxOperation(E),await t.enqueueOutboxOperation(q)}),I(P)
for(const t of S)o("products",t,1e3),o("inventory",t,1e3),r({type:"product",id:t.id,action:"stock-updated"})
return O&&o("customers",O,1e3),k&&(o("customer_ledger",k,1500),r({type:"ledger",id:k.id,customerId:x,action:"appended"})),r({type:"bill",id:P.id,action:"cancelled"}),P}async function N(n,i,a){t(_,{action:"delete_bill",ownerPin:i,entityId:n,reason:a})
const o=await g(n)
if(!o)throw new Error("Bill not found in local records")
const s=(new Date).toISOString(),c={...o,deleted_at:s,deletedAt:s,deleteReason:a?.trim()||null,updatedAt:s,updated_at:s,sync_status:"pending_sync",isSynced:!1,is_synced:!1},u=h("soft_delete_bill",c,i,a,o),p=l(d(u)),y=l({entity_type:"bill",entity_id:c.id,operation_type:"SOFT_DELETE_BILL_PENDING",idempotency_key:`soft-delete-bill:${c.local_id??c.id}:${s}`,payload:{billId:c.id,localBillId:c.local_id??c.id,serverBillId:c.server_id??null,reason:a??null,ownerPin:i,ownerPinProvided:!0}})
return await e.transaction(["bills","local_audit_logs","sync_outbox"],async t=>{await t.put("bills",c),await t.put("local_audit_logs",u),await t.enqueueOutboxOperation(p),await t.enqueueOutboxOperation(y)}),I(c),r({type:"bill",id:c.id,action:"soft_deleted"}),c}async function P(n,i,a){t(_,{action:"restore_from_recycle_bin",ownerPin:i,entityId:n,reason:a})
const o=await g(n)
if(!o)throw new Error("Bill not found in local records")
const s=(new Date).toISOString(),c={...o,deleted_at:null,deletedAt:null,restoreReason:a?.trim()||null,updatedAt:s,updated_at:s,sync_status:"pending_sync",isSynced:!1,is_synced:!1},u=h("restore_bill",c,i,a,o),p=l(d(u)),y=l({entity_type:"bill",entity_id:c.id,operation_type:"RESTORE_BILL_PENDING",idempotency_key:`restore-bill:${c.local_id??c.id}:${s}`,payload:{billId:c.id,localBillId:c.local_id??c.id,serverBillId:c.server_id??null,reason:a??null,ownerPin:i,ownerPinProvided:!0}})
return await e.transaction(["bills","local_audit_logs","sync_outbox"],async t=>{await t.put("bills",c),await t.put("local_audit_logs",u),await t.enqueueOutboxOperation(p),await t.enqueueOutboxOperation(y)}),I(c),r({type:"bill",id:c.id,action:"restored"}),c}export{A as c,P as r,N as s}
