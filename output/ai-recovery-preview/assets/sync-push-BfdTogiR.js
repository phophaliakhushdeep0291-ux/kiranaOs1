import{Y as e,b2 as t,J as n,aN as i,ar as a,b3 as r,b4 as s,a_ as o,b5 as c,b6 as l,b7 as d}from"./index-DhCGH5L2.js"
import{s as y,m as u,r as p,a as _,b as f,c as v,l as m,d as g,e as w,p as h,f as I,g as b,h as E}from"./sync-reconcile-btNMUEr7.js"
import{n as S,s as k,D as A,S as C,i as M,a as N,b as L,r as B,e as D,c as P,d as T,t as x}from"./sync-types-B187FdZc.js"
import{s as j,i as O,b as H}from"./sync-status-repair-CP18WTtH.js"
const Y="sync:last_pull_failure"
async function F(e){try{if(null===e)return void(await n.setSetting(Y,null))
await n.setSetting(Y,{reason:e,at:i()})}catch{}}async function R(){const e=await n.getSetting(Y).catch(()=>null)
return e&&"string"==typeof e.reason?e:null}const G="sync:last_ack_failure"
async function J(e){try{await n.setSetting(G,null===e?null:{...e,at:i()})}catch{}}async function q(){const e=await n.getSetting(G).catch(()=>null)
return e&&"string"==typeof e.reason?e:null}async function K(e){try{const t=await _(e,{background:!0}),n=t?.acknowledgement
await J(n?.stale_ack_ignored?{reason:"the shop already has a later position recorded for this device",acknowledged:String(e),serverApplied:n.applied_server_seq??null}:null)}catch(t){await J({reason:t instanceof Error?t.message:String(t),acknowledged:String(e),serverApplied:null})}}const U=["products","customers","bills","stockLedger","udharLedger","suppliers","purchaseHistory","expenses"]
function V(e){return`entity:${e}`}function z(e){const t=a()
return Boolean(e&&e.tenant_id===t.tenant_id&&e.store_id===t.store_id)}function Z(e,t,n){const r=a(),s=i()
return{id:e,entity_type:t,cursor:null===n?null:String(n),last_pulled_at:s,tenant_id:r.tenant_id,store_id:r.store_id,device_id:r.device_id,created_at:s,updated_at:s,deleted_at:null,version:1,sync_status:"synced",last_modified_by:null}}async function $(){await t.open()
const e=await t.sync_cursor.get(A)
return z(e)?e?.cursor??null:null}async function Q(e){void 0!==e&&""!==e&&(await t.open(),await t.sync_cursor.put(Z(A,"global",e)))}async function W(e){void 0!==e&&""!==e&&(await t.open(),await t.sync_cursor.put(Z(C,"server_sequence",e)))}async function X(e){if(!e||"object"!=typeof e)return
await t.open()
const n=[]
for(const t of U){const i=e[t]
void 0!==i&&""!==i&&n.push(Z(V(t),t,i))}n.length>0&&await t.sync_cursor.bulkPut(n)}function ee(e){const t=M(e.sync)?e.sync:null,n=t&&M(t.entityCursors)?t.entityCursors:null
return n?Object.fromEntries(Object.entries(n).filter(([,e])=>"string"==typeof e||null===e)):null}function te(e){const t=M(e.sync)?e.sync:null
if(!t)return!1
if(!0===t.hasMore)return!0
const n=M(t.hasMoreByEntity)?t.hasMoreByEntity:null
return Boolean(n&&Object.values(n).some(e=>!0===e))}function ne(e){const t=e.changes
return Array.isArray(t)?t.filter(M):M(t)?Object.entries(t).flatMap(([e,t])=>Array.isArray(t)?t.filter(M).map(t=>({entity_type:e,entity:t})):[]):[["products","product"],["customers","customer"],["bills","bill"],["bill_items","bill_item"],["payments","payment"],["customer_ledger","ledger_entry"],["inventory_movements","inventory_movement"],["stockLedger","stock_ledger"],["udharLedger","udhar_ledger"],["suppliers","supplier"],["purchaseHistory","purchase_history"],["expenses","expense"],["settings","settings"]].flatMap(([t,n])=>{const i=e[t]
return Array.isArray(i)?i.filter(M).map(e=>({entity_type:n,entity:e})):[]})}async function ie(){let n=0,i=0,a=await $(),r=await(async()=>{await t.open()
const e=await t.sync_cursor.get(C)
return z(e)?e?.cursor??null:null})(),s=!1
try{for(let e=0;e<10;e+=1){const e=await y({since:"1970-01-01T00:00:00.000Z",cursor:a,afterSeq:r??"0",limit:500,background:!0}),t=ne(e)
let o=0,c=0
for(const n of t){const e=await u(n)
"merged"===e&&(o+=1),"conflict"===e&&(c+=1)}n+=o,i+=c,a=S(e)
const l=k(e)
if(void 0!==l&&(r=l),await Q(a),await W(r),await X(ee(e)),null!=r&&await K(r),s=te(e),!s)break}return await p(),(n>0||i>0)&&e({type:"sync",action:"pull",pulled:n,conflicts:i}),await F(null),{pulled:n,conflicts:i,cursor:a,hasMore:s,failed:!1}}catch(o){const e=o instanceof Error?o.message:String(o)
return await F(e),{pulled:n,conflicts:i,cursor:a,hasMore:s,failed:!0,failureReason:e}}}async function ae(e,i,a,r){await n.updatePendingEventStatus(e.map(e=>e.clientEventId),i,a,r),"SYNCED"!==i&&await(async(e,n)=>{const i=(e=>"SYNCING"===e?"syncing":"SYNCED"===e?"synced":"FAILED"===e?"failed":"CONFLICT"===e?"conflict":"pending_sync")(n)
await t.open()
for(const a of e){const e=D(a.operation_type,a.entity_type),n=x(e)
if(!n||"settings"===n)continue
const r=t.table(n),s=await r.get(a.entity_id).catch(()=>{})
s&&await r.put({...s,sync_status:i,isSynced:"bills"===n?"synced"===i:s.isSynced,is_synced:"bills"===n?"synced"===i:s.is_synced})}})(e,i).catch(()=>{})}const re="undefined"==typeof TextEncoder?null:new TextEncoder
function se(e){let t
try{t=JSON.stringify(e)}catch{return L}return re?re.encode(t).length:3*t.length}function oe(e){return"object"==typeof e&&null!==e&&!Array.isArray(e)}function ce(e){return"string"==typeof e&&e.trim().length>0?e.trim():"number"==typeof e&&Number.isFinite(e)?String(e):void 0}function le(e){return oe(e)?["clientEventId","eventId","op_id","opId","idempotency_key","idempotencyKey","entity_id","entityId","id","local_id","localId","server_id","serverId","billId","bill_id","localBillId","local_bill_id","clientBillId","client_bill_id","serverBillId","server_bill_id","paymentId","payment_id","localPaymentId","local_payment_id","clientPaymentId","client_payment_id","serverPaymentId","server_payment_id","ledgerEntryId","ledger_entry_id","localLedgerEntryId","local_ledger_entry_id","serverLedgerEntryId","server_ledger_entry_id","purchaseHistoryId","purchase_history_id","localPurchaseHistoryId","local_purchase_history_id","purchaseBillId","purchase_bill_id","localPurchaseBillId","local_purchase_bill_id","stockLedgerId","stock_ledger_id","movementId","movement_id","localMovementId","local_movement_id","clientMovementId","client_movement_id","inventoryMovementId","inventory_movement_id","localInventoryMovementId","local_inventory_movement_id","customerId","customer_id","localCustomerId","local_customer_id","serverCustomerId","server_customer_id","productId","product_id","localProductId","local_product_id","serverProductId","server_product_id","expenseId","expense_id","localExpenseId","local_expense_id","batchId","batch_id"].map(t=>ce(e[t])).filter(e=>Boolean(e)):[]}function de(e){const t=oe(e.result)?e.result:{},n=oe(e.entity)?e.entity:{},i=oe(e.data)?e.data:{},a=[e,t,n,i,oe(t.entity)?t.entity:void 0,oe(t.payment)?t.payment:void 0,oe(t.bill)?t.bill:void 0,oe(i.payment)?i.payment:void 0,oe(i.bill)?i.bill:void 0]
return[...new Set(a.flatMap(le))]}async function ye(e,n){if(!((e,t)=>{if("CREATE_LEDGER_ADJUSTMENT"!==e.operation_type)return!1
const n=JSON.stringify(t).toLowerCase()
return n.includes("udhar_adjustment_negative_balance")||n.includes("udhar")&&n.includes("negative")})(e,n))return
const i=await t.customer_ledger.get(e.entity_id).catch(()=>{})
i&&"synced"!==String(i.sync_status??"").toLowerCase()&&await t.customer_ledger.delete(e.entity_id)}async function ue(e,t){const n=new Map
e.forEach(e=>{(e=>{const t=oe(e.event.payload)?e.event.payload:{},n=oe(t.payment)?t.payment:{},i=oe(t.bill)?t.bill:{},a=[e.event.clientEventId,e.event.op_id,e.event.idempotency_key,e.event.entity_id,...le(t),...le(n),...le(i)]
return[...new Set(a.filter(e=>"string"==typeof e&&e.length>0))]})(e).forEach(t=>n.set(t,e))})
const i=new Set
let a=0,r=0,o=0,y=0
for(const p of t){const e=de(p).map(e=>n.get(e)).find(Boolean)
if(!e)continue
i.add(e.event.clientEventId)
const t=P(p),{entityType:u,localId:_,serverId:f,serverEntity:v}=T(p,e.event)
if("success"===t){if("STOCK_PURCHASE_BATCH"===e.event.operation_type){const t=oe(p.result)?p.result:p,n=Array.isArray(t.movements)?t.movements.filter(oe):[],i=Array.isArray(e.event.payload.lines)?e.event.payload.lines.filter(oe):[]
for(let a=0;a<i.length;a+=1){const t=i[a],r=n[a]??{},s=ce(t.localMovementId)??ce(t.movementId)??ce(t.clientMovementId),o=ce(r.stockLedgerId)??ce(r.movementId)
s&&o&&(await h("inventory_movement",s,o),await I("inventory_movement",s,o,r),await b({...e.event,entity_id:s},r,o))}await ae([e.event],"SYNCED"),a+=1
continue}await c(e.event,p)||(await h(u,_,f),await I(u,_,f,v),await b(e.event,v,f)),await ae([e.event],"SYNCED"),a+=1
continue}if("conflict"===t){await ye(e.event,p),await ae([e.event],"CONFLICT",p.error_message??p.error??"Sync conflict")
const t=oe(p.result)?p.result:{},n=oe(p.conflict)?p.conflict:oe(t.conflict)?t.conflict:null,i=n&&"server_snapshot"in n?n.server_snapshot:n&&oe(n.server_record)?n.server_record:p.entity??t.entity??t.server_record??p.result??null,a=ce(p.conflict_id)??ce(t.conflict_id)??ce(n?.id),r=Number(n?.version),s=n?.server_version??p.server_version
await E({entityType:u,entityId:_??e.event.entity_id,sourceId:e.event.op_id,localSnapshot:e.event.payload,serverSnapshot:i,errorMessage:p.error_message??p.error??"Sync conflict",serverConflictId:a,serverRecordVersion:Number.isInteger(r)?r:void 0,serverVersion:"string"==typeof s||"number"==typeof s?s:null}),o+=1
continue}const m=p.error_message??p.error??"Sync failed"
l(p)?(await ae([e.event],"PENDING",m,{deferMs:d(s(e.event))}),y+=1):(await ye(e.event,p),await ae([e.event],"FAILED",m),r+=1)}const u=e.map(e=>e.event).filter(e=>!i.has(e.clientEventId))
if(u.length>0){const e=await m(),t=u.filter(t=>"string"==typeof e[t.entity_id]),n=u.filter(t=>"string"!=typeof e[t.entity_id])
for(const i of t){const t=D(i.operation_type,i.entity_type),n=e[i.entity_id]
await h(t,i.entity_id,n),await I(t,i.entity_id,n),await b(i,void 0,n)}t.length>0&&(await ae(t,"SYNCED"),a+=t.length),n.length>0&&(await ae(n,"FAILED","No sync result returned by server"),r+=n.length)}return{pushed:a,failed:r,conflicts:o,deferred:y}}async function pe(e,t){const n={...t,op_id:e.op_id||e.clientEventId,clientEventId:e.clientEventId,eventId:e.clientEventId}
return 1===(await ue([{event:e,operation:{}}],[n])).pushed}async function _e(){const{prepared:i,skipped:c}=await(async(e=N,i=L)=>{await t.open()
const a=await m()
await j()
const r=o(await n.getPendingEvents()).filter(e=>!O(e)),s=[],c=new Set,l=new Set
let d=!0,y=0,u=!1
for(;s.length<e&&d&&!u;){d=!1
for(const t of r){if(s.length>=e)break
if(c.has(t.clientEventId))continue
const n=D(t.operation_type,t.entity_type),r="STOCK_PURCHASE_BATCH"===t.operation_type&&Array.isArray(t.payload.lines)?t.payload.lines.filter(oe).flatMap(e=>[ce(e.movementId),ce(e.localMovementId),ce(e.clientMovementId)]).filter(e=>Boolean(e)):[],o=new Set([t.entity_id,...r,...l]),p=g(t.payload,a),_=H(t,p)
if(!_)continue
if(w(_.payload,a,o).length>0)continue
const f={op_id:t.op_id,clientEventId:t.clientEventId,eventId:t.clientEventId,idempotency_key:t.idempotency_key,type:_.type,operation_type:_.operation_type,original_operation_type:t.operation_type,entity_type:_.entity_type||n,entity_id:a[t.entity_id]??t.entity_id,tenant_id:t.tenant_id,store_id:t.store_id,device_id:t.device_id,client_created_at:t.client_created_at,retry_count:t.retry_count,payload:_.payload},v=se(f)
if(s.length>0&&y+v>i){u=!0
break}y+=v,s.push({event:t,operation:f}),c.add(t.clientEventId),t.entity_id&&l.add(t.entity_id),d=!0}}return{prepared:s,skipped:r.filter(e=>!c.has(e.clientEventId)).length}})()
if(0===i.length)return{pushed:0,failed:0,conflicts:0,skipped:c}
const l=await $()
await ae(i.map(e=>e.event),"SYNCING")
try{const t=i.map(e=>e.operation),n=a(),r=await f({operations:t,events:t,cursor:l,device_id:n.device_id})
await v(r.idMappings)
const s=B(r),{deferred:o,...d}=await ue(i,s),y=S(r)
return await Q(y),await p(),e({type:"sync",action:"push",pushed:d.pushed,failed:d.failed,conflicts:d.conflicts}),{...d,skipped:c+o}}catch(y){const e=y instanceof Error?y.message:"Network/server error during push sync",t=i.map(e=>e.event)
if(r(y)){const n=Math.max(0,...t.map(s))
return await ae(t,"PENDING",e,{deferMs:d(n)}),{pushed:0,failed:0,conflicts:0,skipped:c+t.length}}return await ae(t,"FAILED",e),{pushed:0,failed:i.length,conflicts:0,skipped:c}}}async function fe(e=_e){let t=0,n=0,i=0,a=0
for(let r=0;r<40;r+=1){const r=await e()
if(t+=r.pushed,n+=r.failed,i+=r.conflicts,a=r.skipped,0===r.pushed||r.failed>0||r.conflicts>0)break}return{pushed:t,failed:n,conflicts:i,skipped:a}}export{q as a,_e as b,pe as c,fe as d,ie as p,R as r}
