import{Y as e,b2 as t,J as n,aN as i,ar as r,a_ as a,b3 as s}from"./index-Ci-XYli4.js"
import{s as o,m as c,r as l,a as d,b as u,c as y,l as p,d as _,e as f,p as v,f as m,g,h}from"./sync-reconcile-CXUAdiJ7.js"
import{n as w,s as I,D as b,S as E,i as S,a as k,b as M,r as A,e as C,c as N,d as L,t as x}from"./sync-types-B187FdZc.js"
import{s as B,i as T,b as D}from"./sync-status-repair-D20_rW1P.js"
const P="sync:last_pull_failure"
async function j(e){try{if(null===e)return void(await n.setSetting(P,null))
await n.setSetting(P,{reason:e,at:i()})}catch{}}async function O(){const e=await n.getSetting(P).catch(()=>null)
return e&&"string"==typeof e.reason?e:null}const F="sync:last_ack_failure"
async function H(e){try{await n.setSetting(F,null===e?null:{...e,at:i()})}catch{}}async function Y(){const e=await n.getSetting(F).catch(()=>null)
return e&&"string"==typeof e.reason?e:null}async function R(e){try{const t=await d(e,{background:!0}),n=t?.acknowledgement
await H(n?.stale_ack_ignored?{reason:"the shop already has a later position recorded for this device",acknowledged:String(e),serverApplied:n.applied_server_seq??null}:null)}catch(t){await H({reason:t instanceof Error?t.message:String(t),acknowledged:String(e),serverApplied:null})}}const G=["products","customers","bills","stockLedger","udharLedger","suppliers","purchaseHistory","expenses"]
function J(e){return`entity:${e}`}function q(e){const t=r()
return Boolean(e&&e.tenant_id===t.tenant_id&&e.store_id===t.store_id)}function K(e,t,n){const a=r(),s=i()
return{id:e,entity_type:t,cursor:null===n?null:String(n),last_pulled_at:s,tenant_id:a.tenant_id,store_id:a.store_id,device_id:a.device_id,created_at:s,updated_at:s,deleted_at:null,version:1,sync_status:"synced",last_modified_by:null}}async function U(){await t.open()
const e=await t.sync_cursor.get(b)
return q(e)?e?.cursor??null:null}async function V(e){void 0!==e&&""!==e&&(await t.open(),await t.sync_cursor.put(K(b,"global",e)))}async function Z(e){void 0!==e&&""!==e&&(await t.open(),await t.sync_cursor.put(K(E,"server_sequence",e)))}async function $(e){if(!e||"object"!=typeof e)return
await t.open()
const n=[]
for(const t of G){const i=e[t]
void 0!==i&&""!==i&&n.push(K(J(t),t,i))}n.length>0&&await t.sync_cursor.bulkPut(n)}function z(e){const t=S(e.sync)?e.sync:null,n=t&&S(t.entityCursors)?t.entityCursors:null
return n?Object.fromEntries(Object.entries(n).filter(([,e])=>"string"==typeof e||null===e)):null}function Q(e){const t=S(e.sync)?e.sync:null
if(!t)return!1
if(!0===t.hasMore)return!0
const n=S(t.hasMoreByEntity)?t.hasMoreByEntity:null
return Boolean(n&&Object.values(n).some(e=>!0===e))}function W(e){const t=e.changes
return Array.isArray(t)?t.filter(S):S(t)?Object.entries(t).flatMap(([e,t])=>Array.isArray(t)?t.filter(S).map(t=>({entity_type:e,entity:t})):[]):[["products","product"],["customers","customer"],["bills","bill"],["bill_items","bill_item"],["payments","payment"],["customer_ledger","ledger_entry"],["inventory_movements","inventory_movement"],["stockLedger","stock_ledger"],["udharLedger","udhar_ledger"],["suppliers","supplier"],["purchaseHistory","purchase_history"],["expenses","expense"],["settings","settings"]].flatMap(([t,n])=>{const i=e[t]
return Array.isArray(i)?i.filter(S).map(e=>({entity_type:n,entity:e})):[]})}async function X(){let n=0,i=0,r=await U(),a=await(async()=>{await t.open()
const e=await t.sync_cursor.get(E)
return q(e)?e?.cursor??null:null})(),s=!1
try{for(let e=0;e<10;e+=1){const e=await o({since:"1970-01-01T00:00:00.000Z",cursor:r,afterSeq:a??"0",limit:500,background:!0}),t=W(e)
let l=0,d=0
for(const n of t){const e=await c(n)
"merged"===e&&(l+=1),"conflict"===e&&(d+=1)}n+=l,i+=d,r=w(e)
const u=I(e)
if(void 0!==u&&(a=u),await V(r),await Z(a),await $(z(e)),null!=a&&await R(a),s=Q(e),!s)break}return await l(),(n>0||i>0)&&e({type:"sync",action:"pull",pulled:n,conflicts:i}),await j(null),{pulled:n,conflicts:i,cursor:r,hasMore:s,failed:!1}}catch(d){const e=d instanceof Error?d.message:String(d)
return await j(e),{pulled:n,conflicts:i,cursor:r,hasMore:s,failed:!0,failureReason:e}}}const ee=new Set([0,401,408,425,429,500,502,503,504,507,508,522,524])
function te(e){const t=Number.isFinite(e)?Math.max(0,Math.trunc(e)):0
return Math.min(3e4,1e3*2**Math.min(t,5))}async function ne(e,i,r,a){await n.updatePendingEventStatus(e.map(e=>e.clientEventId),i,r,a),"SYNCED"!==i&&await(async(e,n)=>{const i=(e=>"SYNCING"===e?"syncing":"SYNCED"===e?"synced":"FAILED"===e?"failed":"CONFLICT"===e?"conflict":"pending_sync")(n)
await t.open()
for(const r of e){const e=C(r.operation_type,r.entity_type),n=x(e)
if(!n||"settings"===n)continue
const a=t.table(n),s=await a.get(r.entity_id).catch(()=>{})
s&&await a.put({...s,sync_status:i,isSynced:"bills"===n?"synced"===i:s.isSynced,is_synced:"bills"===n?"synced"===i:s.is_synced})}})(e,i).catch(()=>{})}const ie="undefined"==typeof TextEncoder?null:new TextEncoder
function re(e){let t
try{t=JSON.stringify(e)}catch{return M}return ie?ie.encode(t).length:3*t.length}function ae(e){return"object"==typeof e&&null!==e&&!Array.isArray(e)}function se(e){return"string"==typeof e&&e.trim().length>0?e.trim():"number"==typeof e&&Number.isFinite(e)?String(e):void 0}function oe(e){return ae(e)?["clientEventId","eventId","op_id","opId","idempotency_key","idempotencyKey","entity_id","entityId","id","local_id","localId","server_id","serverId","billId","bill_id","localBillId","local_bill_id","clientBillId","client_bill_id","serverBillId","server_bill_id","paymentId","payment_id","localPaymentId","local_payment_id","clientPaymentId","client_payment_id","serverPaymentId","server_payment_id","ledgerEntryId","ledger_entry_id","localLedgerEntryId","local_ledger_entry_id","serverLedgerEntryId","server_ledger_entry_id","purchaseHistoryId","purchase_history_id","localPurchaseHistoryId","local_purchase_history_id","purchaseBillId","purchase_bill_id","localPurchaseBillId","local_purchase_bill_id","stockLedgerId","stock_ledger_id","movementId","movement_id","localMovementId","local_movement_id","clientMovementId","client_movement_id","inventoryMovementId","inventory_movement_id","localInventoryMovementId","local_inventory_movement_id","customerId","customer_id","localCustomerId","local_customer_id","serverCustomerId","server_customer_id","productId","product_id","localProductId","local_product_id","serverProductId","server_product_id","expenseId","expense_id","localExpenseId","local_expense_id","batchId","batch_id"].map(t=>se(e[t])).filter(e=>Boolean(e)):[]}function ce(e){const t=ae(e.result)?e.result:{},n=ae(e.entity)?e.entity:{},i=ae(e.data)?e.data:{},r=[e,t,n,i,ae(t.entity)?t.entity:void 0,ae(t.payment)?t.payment:void 0,ae(t.bill)?t.bill:void 0,ae(i.payment)?i.payment:void 0,ae(i.bill)?i.bill:void 0]
return[...new Set(r.flatMap(oe))]}async function le(e,n){if(!((e,t)=>{if("CREATE_LEDGER_ADJUSTMENT"!==e.operation_type)return!1
const n=JSON.stringify(t).toLowerCase()
return n.includes("udhar_adjustment_negative_balance")||n.includes("udhar")&&n.includes("negative")})(e,n))return
const i=await t.customer_ledger.get(e.entity_id).catch(()=>{})
i&&"synced"!==String(i.sync_status??"").toLowerCase()&&await t.customer_ledger.delete(e.entity_id)}async function de(e,t){const n=new Map
e.forEach(e=>{(e=>{const t=ae(e.event.payload)?e.event.payload:{},n=ae(t.payment)?t.payment:{},i=ae(t.bill)?t.bill:{},r=[e.event.clientEventId,e.event.op_id,e.event.idempotency_key,e.event.entity_id,...oe(t),...oe(n),...oe(i)]
return[...new Set(r.filter(e=>"string"==typeof e&&e.length>0))]})(e).forEach(t=>n.set(t,e))})
const i=new Set
let r=0,a=0,o=0
for(const l of t){const e=ce(l).map(e=>n.get(e)).find(Boolean)
if(!e)continue
i.add(e.event.clientEventId)
const t=N(l),{entityType:c,localId:d,serverId:u,serverEntity:y}=L(l,e.event)
if("success"!==t){if("conflict"===t){await le(e.event,l),await ne([e.event],"CONFLICT",l.error_message??l.error??"Sync conflict")
const t=ae(l.result)?l.result:{},n=ae(l.conflict)?l.conflict:ae(t.conflict)?t.conflict:null,i=n&&"server_snapshot"in n?n.server_snapshot:n&&ae(n.server_record)?n.server_record:l.entity??t.entity??t.server_record??l.result??null,r=se(l.conflict_id)??se(t.conflict_id)??se(n?.id),a=Number(n?.version),s=n?.server_version??l.server_version
await h({entityType:c,entityId:d??e.event.entity_id,sourceId:e.event.op_id,localSnapshot:e.event.payload,serverSnapshot:i,errorMessage:l.error_message??l.error??"Sync conflict",serverConflictId:r,serverRecordVersion:Number.isInteger(a)?a:void 0,serverVersion:"string"==typeof s||"number"==typeof s?s:null}),o+=1
continue}await le(e.event,l),await ne([e.event],"FAILED",l.error_message??l.error??"Sync failed"),a+=1}else{if("STOCK_PURCHASE_BATCH"===e.event.operation_type){const t=ae(l.result)?l.result:l,n=Array.isArray(t.movements)?t.movements.filter(ae):[],i=Array.isArray(e.event.payload.lines)?e.event.payload.lines.filter(ae):[]
for(let r=0;r<i.length;r+=1){const t=i[r],a=n[r]??{},s=se(t.localMovementId)??se(t.movementId)??se(t.clientMovementId),o=se(a.stockLedgerId)??se(a.movementId)
s&&o&&(await v("inventory_movement",s,o),await m("inventory_movement",s,o,a),await g({...e.event,entity_id:s},a,o))}await ne([e.event],"SYNCED"),r+=1
continue}await s(e.event,l)||(await v(c,d,u),await m(c,d,u,y),await g(e.event,y,u)),await ne([e.event],"SYNCED"),r+=1}}const c=e.map(e=>e.event).filter(e=>!i.has(e.clientEventId))
if(c.length>0){const e=await p(),t=c.filter(t=>"string"==typeof e[t.entity_id]),n=c.filter(t=>"string"!=typeof e[t.entity_id])
for(const i of t){const t=C(i.operation_type,i.entity_type),n=e[i.entity_id]
await v(t,i.entity_id,n),await m(t,i.entity_id,n),await g(i,void 0,n)}t.length>0&&(await ne(t,"SYNCED"),r+=t.length),n.length>0&&(await ne(n,"FAILED","No sync result returned by server"),a+=n.length)}return{pushed:r,failed:a,conflicts:o}}async function ue(e,t){const n={...t,op_id:e.op_id||e.clientEventId,clientEventId:e.clientEventId,eventId:e.clientEventId}
return 1===(await de([{event:e,operation:{}}],[n])).pushed}async function ye(){const{prepared:i,skipped:s}=await(async(e=k,i=M)=>{await t.open()
const r=await p()
await B()
const s=a(await n.getPendingEvents()).filter(e=>!T(e)),o=[],c=new Set,l=new Set
let d=!0,u=0,y=!1
for(;o.length<e&&d&&!y;){d=!1
for(const t of s){if(o.length>=e)break
if(c.has(t.clientEventId))continue
const n=C(t.operation_type,t.entity_type),a="STOCK_PURCHASE_BATCH"===t.operation_type&&Array.isArray(t.payload.lines)?t.payload.lines.filter(ae).flatMap(e=>[se(e.movementId),se(e.localMovementId),se(e.clientMovementId)]).filter(e=>Boolean(e)):[],s=new Set([t.entity_id,...a,...l]),p=_(t.payload,r),v=D(t,p)
if(!v)continue
if(f(v.payload,r,s).length>0)continue
const m={op_id:t.op_id,clientEventId:t.clientEventId,eventId:t.clientEventId,idempotency_key:t.idempotency_key,type:v.type,operation_type:v.operation_type,original_operation_type:t.operation_type,entity_type:v.entity_type||n,entity_id:r[t.entity_id]??t.entity_id,tenant_id:t.tenant_id,store_id:t.store_id,device_id:t.device_id,client_created_at:t.client_created_at,retry_count:t.retry_count,payload:v.payload},g=re(m)
if(o.length>0&&u+g>i){y=!0
break}u+=g,o.push({event:t,operation:m}),c.add(t.clientEventId),t.entity_id&&l.add(t.entity_id),d=!0}}return{prepared:o,skipped:s.filter(e=>!c.has(e.clientEventId)).length}})()
if(0===i.length)return{pushed:0,failed:0,conflicts:0,skipped:s}
const o=await U()
await ne(i.map(e=>e.event),"SYNCING")
try{const t=i.map(e=>e.operation),n=r(),a=await u({operations:t,events:t,cursor:o,device_id:n.device_id})
await y(a.idMappings)
const c=A(a),d=await de(i,c),p=w(a)
return await V(p),await l(),e({type:"sync",action:"push",pushed:d.pushed,failed:d.failed,conflicts:d.conflicts}),{...d,skipped:s}}catch(c){const e=c instanceof Error?c.message:"Network/server error during push sync",t=i.map(e=>e.event)
if((e=>{const t=(e=>{if("object"!=typeof e||null===e)return
const t=e.status
return"number"==typeof t&&Number.isFinite(t)?t:void 0})(e)
return void 0===t||!!ee.has(t)||t>=500})(c)){const n=Math.max(0,...t.map(e=>e.retry_count??e.attempts??0))
return await ne(t,"PENDING",e,{deferMs:te(n)}),{pushed:0,failed:0,conflicts:0,skipped:s+t.length}}return await ne(t,"FAILED",e),{pushed:0,failed:i.length,conflicts:0,skipped:s}}}async function pe(e=ye){let t=0,n=0,i=0,r=0
for(let a=0;a<40;a+=1){const a=await e()
if(t+=a.pushed,n+=a.failed,i+=a.conflicts,r=a.skipped,0===a.pushed||a.failed>0||a.conflicts>0)break}return{pushed:t,failed:n,conflicts:i,skipped:r}}export{Y as a,ye as b,ue as c,pe as d,X as p,O as r}
