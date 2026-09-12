import{ak as e,N as t,aI as n,P as a,Q as r,T as o,b0 as d,X as s,V as i,ar as c,bB as u,a8 as m,a9 as l,a6 as y,J as p,U as _,bC as g,bD as I,aM as f,as as w,at as h,au as E,av as A,aw as v,ax as b,Y as S,bE as P,bF as x,aE as M,bG as O}from"./index-Ci-XYli4.js"
import{n as L}from"./local-actions-4U90yWOU.js"
async function N(){const t=await e("/udhar/summary")
return{totalOutstanding:Number(t.totalOutstanding??0),customers:(t.customers??[]).map(e=>({customerId:e.customerId??e.id??"",customerName:e.customerName??e.name??"Customer",mobile:e.mobile,amount:e.amount??e.udharAmount??0,outstanding:e.outstanding??e.amount??e.udharAmount??0}))}}const T="udhar_authoritative_summary"
function D(e){if(!e||"object"!=typeof e)return!1
const t=e
return Boolean(t.summary&&Array.isArray(t.summary.customers))}function C(){const e=t(T,null)
return D(e)?e:null}async function $(){const e=C()
if(e)return e
const t=await n(T,null).catch(()=>null)
return D(t)?t:null}function U(e){const t={summary:e,capturedAt:(new Date).toISOString()}
return s(T,t,365),t}async function j(){if(i())try{const e=await N()
return{summary:e,source:"server",capturedAt:U(e).capturedAt}}catch{}const e=await $()
return e?{summary:e.summary,source:"cache",capturedAt:e.capturedAt}:{summary:null,source:"none",capturedAt:null}}function k(e,t,n){const s=((e,t)=>{if(!e)return null
const n=new Set(t.filter(e=>"string"==typeof e&&e.length>0))
if(0===n.size)return null
const a=e.customers.find(e=>n.has(e.customerId))
return a?Math.max(0,Number(a.outstanding??0)):0})(e,t)
if(null===s)return null
const i=new Set(t),c=new Set(["pending_sync","syncing","failed","local_only"])
let u=s
for(const m of a(n)){const e=r(m)
e&&i.has(e)&&c.has(String(m.sync_status??"").toLowerCase())&&(u=o(u+d(m)))}return o(Math.max(0,u))}const B=new Map
function R(e,t){const n=c(),a=`artha:customer-finance:${n.tenant_id}:${n.store_id}:${e}`
return(async(e,t)=>{const n=B.get(e)??Promise.resolve()
let a
const r=new Promise(e=>{a=e}),o=n.then(()=>r)
B.set(e,o),await n
try{return await t()}finally{a(),B.get(e)===o&&B.delete(e)}})(a,()=>u(a,t))}function K(e){return new Set([e?.id,e?.local_id,e?.localId,e?.server_id,e?.serverId].filter(e=>"string"==typeof e&&e.length>0))}function V(e,t){for(const n of t){const t=e[n]
if("string"==typeof t&&t.trim().length>0)return t.trim()
if("number"==typeof t&&Number.isFinite(t))return String(t)}return null}function q(e,t){const n=new Set(e)
let a=!0
for(;a;){a=!1
for(const e of t){const t=String(e.entity_type??e.entityType??"")
if(t&&"customer"!==t&&"customers"!==t)continue
const r=V(e,["local_id","localId"]),o=V(e,["server_id","serverId"])
r&&o&&(n.has(r)&&!n.has(o)&&(n.add(o),a=!0),n.has(o)&&!n.has(r)&&(n.add(r),a=!0))}}return n}async function Y(e){const t=await(async e=>{const[t,n]=await Promise.all([p.getAll("customers").catch(()=>[]),p.getAll("id_mappings").catch(()=>[])]),a=t.find(t=>q(K(t),n).has(e))
return new Set([e,...q(K(a),n)])})(e),n=await p.getAll("customer_ledger").catch(()=>[])
return a(n).filter(e=>{const n=e.customerId??e.customer_id
return"string"==typeof n&&t.has(n)})}function G(e){return R(e.customerId,()=>(async e=>{m(l,{action:"ledger_adjustment",ownerPin:e.ownerPin,entityId:e.customerId,reason:e.note})
const t=o(y(e.amount,0))
if(0===t)throw new Error("Adjustment amount cannot be zero")
const[n,a,r,d]=await Promise.all([Y(e.customerId),p.getAll("customers").catch(()=>[]),p.getAll("id_mappings").catch(()=>[]),$()]),s=a.find(t=>q(K(t),r).has(e.customerId))
if(!s)throw new Error("Customer not found in local records")
const i=o(Math.max(0,_(n))),c=!0===s.balance_derived_from_local_ledger?Math.max(0,y(s.udharAmount??s.totalUdhar,0)):null,u=d?k(d.summary,[...q(K(s),r)],n):null,P=o(null!==u?u:null!==c?c:void 0!==e.expectedOutstanding?Math.max(0,y(e.expectedOutstanding,0)):i)
if(g(I(P,t))<0){const e=new Error(`Adjustment would make udhar negative. Maximum reduction is ${f(P)}`)
throw e.code="UDHAR_ADJUSTMENT_NEGATIVE_BALANCE",e}const x=(new Date).toISOString(),M=w("ledger"),O=w("manual_adjustment"),L=`ledger-adjustment:${e.customerId}:${M}`,N=o(Math.max(0,I(P,t))),T=e.note?.trim()||"Manual ledger adjustment",D=h({id:M,customerId:e.customerId,customer_id:e.customerId,type:"ADJUSTMENT",source_type:"manual_adjustment",source_id:O,amount:t,balance_after:N,note:T,idempotencyKey:L,idempotency_key:L,localLedgerEntryId:M,local_ledger_entry_id:M,clientLedgerId:M,client_ledger_id:M,entry_at:x,createdAt:x,created_at:x},"ledger_entry","pending_sync"),C={...s,type:N>0?"udhar":s.type??"regular",udharAmount:N,totalUdhar:N,updatedAt:x,updated_at:x,sync_status:String(s.sync_status??"synced"),balance_derived_from_local_ledger:!0},U=E({action:"ledger_adjusted",entityType:"ledger_entry",entityId:M,entityLabel:s.name,newValue:D,reason:T,ownerPinProvided:!0,summary:`Udhar adjusted by ${f(t)} for ${s.name}`}),j=A(v(U)),B=A({entity_type:"ledger_entry",entity_id:M,operation_type:"CREATE_LEDGER_ADJUSTMENT",idempotency_key:L,payload:{ledgerEntryId:M,localLedgerEntryId:M,local_ledger_entry_id:M,clientLedgerId:M,client_ledger_id:M,idempotencyKey:L,idempotency_key:L,customerId:e.customerId,amount:t,note:T,ownerPin:e.ownerPin,ownerPinProvided:!0}})
return await p.transaction(["customer_ledger","customers","local_audit_logs","sync_outbox"],async e=>{await e.put("customer_ledger",D),await e.put("customers",C),await e.put("local_audit_logs",U),await e.enqueueOutboxOperation(j),await e.enqueueOutboxOperation(B)}),b("customer_ledger",D,1500),b("customers",C,1e3),S({type:"ledger",id:D.id,customerId:e.customerId,action:"appended"}),D})(e))}const J="customers",z="payments",F=new Set(["pending_sync","syncing","failed","local_only"])
function H(e,t){for(const n of t){const t=e[n]
if("string"==typeof t&&t.trim().length>0)return t.trim()
if("number"==typeof t&&Number.isFinite(t))return String(t)}return null}function X(e,t){return new Set([t,e?.id,e?.local_id,e?.localId,e?.server_id,e?.serverId].filter(e=>"string"==typeof e&&e.length>0))}function Q(e,t){const n=new Set(e)
let a=!0
for(;a;){a=!1
for(const e of t){const t=String(e.entity_type??e.entityType??"")
if(t&&"customer"!==t&&"customers"!==t)continue
const r=H(e,["local_id","localId"]),o=H(e,["server_id","serverId"])
r&&o&&(n.has(r)&&!n.has(o)&&(n.add(o),a=!0),n.has(o)&&!n.has(r)&&(n.add(r),a=!0))}}return n}function W(e){const t=new Map
for(const n of e)"string"==typeof n.id&&0!==n.id.length&&t.set(n.id,{...t.get(n.id),...n})
return[...t.values()]}function Z(e,t){let n=0
for(const a of t)n=o(n+(e.get(a)??0))
return n}function ee(e,t){const n=o(Math.max(0,t))
return{...e,amount:n,outstanding:n}}function te(e){const t=e.customers.map(e=>L(e)),n=a(e.ledgerEntries),s=e.idMappings??[],i=e.authoritative
if(i){const e=(e=>{const t=new Map
for(const n of e){const e=String(n.sync_status??"").toLowerCase()
if(!F.has(e))continue
const a=r(n)
a&&t.set(a,o((t.get(a)??0)+d(n)))}return t})(n),a=new Map,c=new Set
for(const n of i.summary.customers){const r=t.find(e=>Q(X(e),s).has(n.customerId)),d=Q(X(r,n.customerId),s)
d.forEach(e=>c.add(e))
const i=o(Math.max(0,Number(n.outstanding??0)+Z(e,d)))
i>0&&a.set(n.customerId,ee(n,i))}for(const n of t){const t=Q(X(n),s)
if([...t].some(e=>c.has(e)))continue
const r=o(Math.max(0,Z(e,t)))
r<=0||a.set(n.id,{customerId:n.id,customerName:n.name,mobile:n.mobile??void 0,amount:r,outstanding:r})}const u=[...a.values()].filter(e=>e.outstanding>0)
return{totalOutstanding:o(u.reduce((e,t)=>e+t.outstanding,0)),customers:u}}const c=t.map(e=>{const t=Q(X(e),s),a=n.filter(e=>{const n=r(e)
return!!n&&t.has(n)}),d=a.length>0?_(a):y(e.udharAmount??e.totalUdhar,0),i=o(Math.max(0,d))
return{customerId:e.id,customerName:e.name,mobile:e.mobile??void 0,amount:i,outstanding:i,dueDate:e.dueDate,promiseToPayDate:e.promiseToPayDate,trustScore:y(e.trustScore,75)}}).filter(e=>e.outstanding>0)
return{totalOutstanding:o(c.reduce((e,t)=>e+t.outstanding,0)),customers:c}}function ne(){return te({customers:t(J,[]),ledgerEntries:t("customer_ledger",[]),authoritative:C()})}async function ae(){const[e,n,r,o]=await Promise.all([p.getAll("customers").catch(()=>[]),p.getAll("customer_ledger").catch(()=>[]),p.getAll("id_mappings").catch(()=>[]),$()])
return te({customers:W([...t(J,[]),...e]),ledgerEntries:a([...t("customer_ledger",[]),...n]),authoritative:o,idMappings:r})}async function re(e){return(await p.getAll("customers")).map(L).find(t=>X(t).has(e))}const oe=["payments","customer_ledger","customers","local_audit_logs","sync_outbox"]
async function de(e){const t=await $()
if(!t)return null
const n=await p.getAll("id_mappings").catch(()=>[]),a=Q(X(e.customer,e.customerId),n)
return k(t.summary,[...a],e.ledgerEntries)}async function se(e,t,n={}){if(0===t.length)throw new Error("Add at least one payment")
const a=t.map(t=>({data:t,validated:m(x,{...t,customerId:e})})),r=(new Date).toISOString(),d=o(a.reduce((e,t)=>e+o(t.validated.amount),0)),s=await re(e)
if(!s)throw new Error("Customer not found in local records")
const i=await Y(e),c=o(_(i)),u=await de({customerId:e,customer:s,ledgerEntries:i}),l=Math.max(0,y(n.expectedOutstanding,0)),g=!0===s.balance_derived_from_local_ledger?Math.max(0,y(s.udharAmount??s.totalUdhar,0)):null,I=o(null!==u?u:null!==g?Math.max(c,g):Math.max(c,l)),N=o(Math.max(0,I))
if(M(d,N)){const e=new Error(`Payment ${f(d)} exceeds outstanding udhar ${f(N)}`)
throw e.code="UDHAR_PAYMENT_EXCEEDS_OUTSTANDING",e}let T=I
const D=a.map(({data:t,validated:n})=>{const a=o(n.amount),d=w("payment"),i=w("ledger"),c=`record-payment:${e}:${d}`
T=Math.max(0,O(T,a))
const u=T,m="string"==typeof n.note?n.note:void 0,l="string"==typeof n.paidAt?n.paidAt:r,y=h({id:d,customerId:e,customer_id:e,localPaymentId:d,local_payment_id:d,clientPaymentId:d,client_payment_id:d,ledgerEntryId:i,ledger_entry_id:i,localLedgerEntryId:i,local_ledger_entry_id:i,clientLedgerId:i,client_ledger_id:i,idempotencyKey:c,idempotency_key:c,mode:n.mode,amount:a,note:m,paidAt:l,paid_at:l,createdAt:r,created_at:r,status:"active"},"payment","pending_sync"),p=(_={customerId:e,paymentId:d,ledgerEntryId:i,idempotencyKey:c,amount:a,mode:n.mode,nextBalance:u,note:m,at:l},h({id:_.ledgerEntryId,customerId:_.customerId,customer_id:_.customerId,type:"PAYMENT",source_type:"payment",source_id:_.paymentId,paymentId:_.paymentId,payment_id:_.paymentId,localPaymentId:_.paymentId,local_payment_id:_.paymentId,clientPaymentId:_.paymentId,client_payment_id:_.paymentId,ledgerEntryId:_.ledgerEntryId,ledger_entry_id:_.ledgerEntryId,localLedgerEntryId:_.ledgerEntryId,local_ledger_entry_id:_.ledgerEntryId,clientLedgerId:_.ledgerEntryId,client_ledger_id:_.ledgerEntryId,idempotencyKey:_.idempotencyKey,idempotency_key:_.idempotencyKey,mode:_.mode,paymentMode:_.mode,payment_mode:_.mode,amount:_.amount,balance_after:_.nextBalance,note:_.note,entry_at:_.at,createdAt:_.at,created_at:_.at},"ledger_entry","pending_sync"))
var _
const g=E({action:"payment_recorded",entityType:"payment",entityId:d,entityLabel:s.name,newValue:y,summary:`Payment ₹${a.toLocaleString("en-IN")} recorded from ${s.name}`})
return{amount:a,paymentId:d,nextBalance:u,payment:y,ledgerEntry:p,auditLog:g,auditOutbox:A(v(g)),paymentOutbox:A({entity_type:"payment",entity_id:d,operation_type:"RECORD_PAYMENT",idempotency_key:c,payload:{paymentId:d,localPaymentId:d,local_payment_id:d,clientPaymentId:d,client_payment_id:d,ledgerEntryId:i,ledger_entry_id:i,localLedgerEntryId:i,local_ledger_entry_id:i,clientLedgerId:i,client_ledger_id:i,idempotencyKey:c,idempotency_key:c,customerId:e,payment:{...t,amount:a,mode:n.mode,paidAt:l,paymentId:d,localPaymentId:d,local_payment_id:d,clientPaymentId:d,client_payment_id:d,ledgerEntryId:i,ledger_entry_id:i,localLedgerEntryId:i,local_ledger_entry_id:i,clientLedgerId:i,client_ledger_id:i,idempotencyKey:c,idempotency_key:c}}})}}),C=T,$=L({...s,udharAmount:C,totalUdhar:C,updatedAt:r}),U=P($,[...i,...D.map(e=>e.ledgerEntry)]),j={...$,updated_at:r,trustScore:U.trustScore,badCustomer:U.isBadCustomer,sync_status:String(s.sync_status??"synced"),balance_derived_from_local_ledger:!0}
await p.transaction(oe,async e=>{await e.putMany("payments",D.map(e=>e.payment)),await e.putMany("customer_ledger",D.map(e=>e.ledgerEntry)),await e.put("customers",j),await e.putMany("local_audit_logs",D.map(e=>e.auditLog))
for(const t of D)await e.enqueueOutboxOperation(t.auditOutbox),await e.enqueueOutboxOperation(t.paymentOutbox)}),b(J,j,1e3)
for(const o of D)b(z,o.payment,1e3),b("customer_ledger",o.ledgerEntry,1500),S({type:"payment",id:o.paymentId,customerId:e,action:"recorded"}),S({type:"ledger",id:o.ledgerEntry.id,customerId:e,action:"appended"})
return D.map(t=>({success:!0,paymentId:t.paymentId,customerId:e,amount:t.amount,nextBalance:t.nextBalance,pendingSync:!0}))}function ie(e,t,n={}){return R(e,async()=>(await se(e,[t],n))[0])}function ce(e,t,n={}){return R(e,()=>se(e,t,n))}async function ue(e){m(l,{action:"reverse_payment",ownerPin:e.ownerPin,entityId:e.paymentId,reason:e.reason})
const t=(await p.getAll("payments").catch(()=>[])).find(t=>t.id===e.paymentId||t.local_id===e.paymentId||t.server_id===e.paymentId)
if(!t)throw new Error("Payment not found in local records")
const n=String(t.customerId??t.customer_id??"")
if(!n)throw new Error("Payment is not linked to a customer")
return R(n,()=>(async(e,t)=>{const n=(new Date).toISOString(),a=(await p.getAll("payments").catch(()=>[])).find(t=>t.id===e.paymentId||t.local_id===e.paymentId||t.server_id===e.paymentId)
if(!a)throw new Error("Payment not found in local records")
if(a.reversed_at||a.reversedAt)throw new Error("Payment is already reversed")
if(String(a.customerId??a.customer_id??"")!==t)throw new Error("Payment customer changed before reversal")
const r=await re(t)
if(!r)throw new Error("Customer not found in local records")
const d=o(y(a.amount,0))
if(d<=0)throw new Error("Payment reversal amount must be greater than zero")
const s=e.reason?.trim()||"Payment reversal",i=h({...a,id:String(a.id),status:"reversed",reversedAt:n,reversed_at:n,reverseReason:s,reverse_reason:s,sync_status:"pending_sync",updatedAt:n,updated_at:n},"payment","pending_sync"),c=await Y(t),u=h({id:w("ledger"),customerId:t,customer_id:t,type:"CORRECTION",source_type:"payment_reversal",source_id:e.paymentId,paymentId:e.paymentId,payment_id:e.paymentId,amount:d,note:s,entry_at:n,createdAt:n,created_at:n},"ledger_entry","pending_sync"),m=await de({customerId:t,customer:r,ledgerEntries:c}),l=!0===r.balance_derived_from_local_ledger?Math.max(0,y(r.udharAmount??r.totalUdhar,0)):null,g=null!==m?m:null!==l?l:Math.max(0,_(c)),I=o(g+d),f={...u,balance_after:I,sync_status:"pending_sync"},x=L({...r,type:I>0?"udhar":r.type??"regular",udharAmount:I,totalUdhar:I,updatedAt:n}),M=P(x,[...c,f]),O={...x,updated_at:n,trustScore:M.trustScore,badCustomer:M.isBadCustomer,sync_status:String(r.sync_status??"synced"),balance_derived_from_local_ledger:!0},N=E({action:"payment_reversed",entityType:"payment",entityId:e.paymentId,entityLabel:String(r.name??t),oldValue:a,newValue:i,reason:s,ownerPinProvided:e.ownerPin.length>0,summary:`Payment reversal ₹${d.toLocaleString("en-IN")}`}),T=A(v(N)),D=A({entity_type:"payment",entity_id:e.paymentId,operation_type:"REVERSE_PAYMENT",idempotency_key:`reverse-payment:${e.paymentId}`,payload:{paymentId:e.paymentId,customerId:t,ledgerEntryId:String(a.ledgerEntryId??a.ledger_entry_id??""),localLedgerEntryId:String(a.localLedgerEntryId??a.local_ledger_entry_id??a.ledgerEntryId??a.ledger_entry_id??""),correctionId:f.id,amount:d,reason:s,ownerPin:e.ownerPin,ownerPinProvided:!0}})
return await p.transaction(oe,async e=>{await e.put("payments",i),await e.put("customer_ledger",f),await e.put("customers",O),await e.put("local_audit_logs",N),await e.enqueueOutboxOperation(T),await e.enqueueOutboxOperation(D)}),b(z,i,1e3),b(J,O,1e3),b("customer_ledger",f,1500),S({type:"payment",id:e.paymentId,customerId:t,action:"reversed"}),S({type:"ledger",id:f.id,customerId:t,action:"appended"}),{success:!0,paymentId:e.paymentId,correctionId:f.id,nextBalance:I,pendingSync:!0}})(e,n))}export{ue as a,j as b,G as c,ae as d,N as e,U as f,ne as g,ce as h,$ as l,ie as r}
