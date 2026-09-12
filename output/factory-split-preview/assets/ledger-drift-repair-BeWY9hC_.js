import{aB as e,aM as t,N as r,T as n,J as a,P as s,M as o,Z as i,c1 as l,c2 as c,bE as u,aA as d,aZ as m,bC as g}from"./index-CYG8yywH.js"
import{resyncUdharLedgerFromServer as f}from"./cloud-hydration-C1vqnhFy.js"
import{r as h}from"./sync-reconcile-lGRdyR1D.js"
const _=new Set(["pending_sync","syncing","failed","conflict","local_only"])
function p(e){return[e.id,e.local_id,e.localId,e.server_id,e.serverId].filter(e=>"string"==typeof e&&e.length>0)}function y(e){return e.some(e=>_.has(String(e.sync_status??"").toLowerCase()))}function b(e){if("string"!=typeof e.server_id&&"string"!=typeof e.serverId){const t=String(e.sync_status??"").toLowerCase()
if(String(e.id).startsWith("local_")||_.has(t))return!0
if(!1===e.isSynced||!1===e.is_synced)return!0}return!0===e.hasUnsyncedLedgerEntries}function I(e){return e.filter(e=>!0!==e.ledger_only).map(e=>({ids:p(e),localBalance:Number(e.rawLedgerBalance??e.ledgerBalance??0),hasPendingLocalWork:b(e)}))}function S(e,t){if(b(e))return e
const r=p(e).find(e=>t.has(e))
return((e,t)=>{const r=n(Math.max(0,t)),a=Math.abs(r-e.ledgerBalance)<.005?e.ledgerMetrics:{...e.ledgerMetrics,balance:r,ageing:{total:r,zeroToSeven:r,sevenToThirty:0,thirtyPlus:0},isBadCustomer:r>v(e.udharLimit,Number.POSITIVE_INFINITY)}
return{...e,type:r>0?"udhar":"udhar"===e.type?"regular":e.type,ledgerBalance:r,rawLedgerBalance:e.rawLedgerBalance??e.ledgerBalance,totalUdhar:r,udharAmount:r,ledgerMetrics:a,balance_source:"server_ledger_summary"}})(e,r?Number(t.get(r)??0):0)}function w(e,t){return S(e,new Map(t.customers.map(e=>[e.customerId,e.outstanding])))}function N(e,t){const r=new Map(t.customers.map(e=>[e.customerId,e.outstanding])),a=new Set,s=e.map(e=>{const t=p(e).find(e=>r.has(e))
return t&&a.add(t),S(e,r)})
for(const o of t.customers){if(a.has(o.customerId))continue
const e=n(Math.max(0,Number(o.outstanding??0)))
s.push({id:o.customerId,name:o.customerName,mobile:o.mobile??null,type:e>0?"udhar":"regular",udharAmount:e,totalUdhar:e,ledgerBalance:e,rawLedgerBalance:e,sync_status:"synced",balance_source:"server_ledger_summary",ledger_only:!0,ledgerMetrics:{balance:e,ageing:{total:e,zeroToSeven:e,sevenToThirty:0,thirtyPlus:0},paymentCount:0,billCount:0,trustScore:100,isBadCustomer:!1,warning:null}})}return s.sort((e,t)=>t.ledgerBalance-e.ledgerBalance||e.name.localeCompare(t.name))}function A(e,t,r){const a=n(Math.max(0,r))
return e.map(e=>p(e).includes(t)?{...e,type:a>0?"udhar":"udhar"===e.type?"regular":e.type,ledgerBalance:a,totalUdhar:a,udharAmount:a,balance_source:"local_payment_projection",hasUnsyncedLedgerEntries:!0,ledgerMetrics:{...e.ledgerMetrics,balance:a,ageing:{...e.ledgerMetrics.ageing,total:a,zeroToSeven:a,sevenToThirty:0,thirtyPlus:0},isBadCustomer:a>v(e.udharLimit,Number.POSITIVE_INFINITY)}}:e)}function v(e,t=0){const r=Number(e??t)
return Number.isFinite(r)?r:t}function M(e){return"string"==typeof e.deleted_at||"string"==typeof e.deletedAt}function C(e,t){for(const r of t){const t=e[r]
if("string"==typeof t&&t.trim().length>0)return t.trim()
if("number"==typeof t&&Number.isFinite(t))return String(t)}return null}function B(e){return C(e,["customerId","customer_id","serverCustomerId","server_customer_id","localCustomerId","local_customer_id"])}function T(t){const r=t
if("PAYMENT"!==d(t.type,t.source_type))return null
if(e(t)||M(r))return null
const a=String(r.mode??r.payment_mode??"").trim().toLowerCase()
if(!["cash","upi","bank"].includes(a))return null
const s=n(Math.abs(Number(t.amount??0)))
if(s<=0)return null
const o=C(r,["payment_id","paymentId","source_id","sourceId","client_payment_id","clientPaymentId"]),i=c(t)
return{id:o??`ledger-payment:${t.id}`,customer_id:B(t),amount:s,mode:a,note:"string"==typeof t.note?t.note:null,paid_at:i,created_at:i,reversed_at:t.reversed_at??null,ledger_entry_id:t.id,sync_status:t.sync_status??"synced",derived_from_ledger:!0}}function L(e){const t=new Map
for(const r of e)t.set(r.id,{...t.get(r.id),...r})
return Array.from(t.values())}function P(e){return new Set([e.id,e.local_id,e.localId,e.server_id,e.serverId].filter(e=>"string"==typeof e&&e.length>0))}function D(e,t){const r=new Set(e)
let n=!0
for(;n;){n=!1
for(const e of t){const t=String(e.entity_type??e.entityType??"")
if(t&&"customer"!==t&&"customers"!==t)continue
const a=C(e,["local_id","localId"]),s=C(e,["server_id","serverId"])
a&&s&&(r.has(a)&&!r.has(s)&&(r.add(s),n=!0),r.has(s)&&!r.has(a)&&(r.add(a),n=!0))}}return r}function U(e){return e?C(e,["customerMobile","customer_mobile","mobile","phone"]):null}function $(){return r("customers",[]).filter(e=>!M(e)).map(e=>{const t=n(Math.max(0,Number(e.udharAmount??e.totalUdhar??0))),r=Number(e.udharLimit??Number.POSITIVE_INFINITY)
return{...e,ledgerBalance:t,rawLedgerBalance:t,totalUdhar:t,udharAmount:t,ledgerMetrics:{balance:t,ageing:{total:t,zeroToSeven:t,sevenToThirty:0,thirtyPlus:0},paymentCount:0,billCount:0,trustScore:Number(e.trustScore??75),isBadCustomer:Number.isFinite(r)&&t>r,warning:null}}})}let E=!1
async function x(){(()=>{if(E||"undefined"==typeof window)return
E=!0
const e=()=>{m().catch(()=>{})},t=window
t.requestIdleCallback?t.requestIdleCallback(e,{timeout:5e3}):window.setTimeout(e,750)})()
const e=r("customers",[]),[t,o,i]=await Promise.all([a.getAll("customers").catch(()=>[]),a.getAll("customer_ledger").catch(()=>[]),a.getAll("id_mappings").catch(()=>[])]),l=L([...e,...t].filter(e=>!M(e))),d=s(o),g=new Set(l.flatMap(e=>[...D(P(e),i)])),f=new Map,h=new Map
for(const r of d){const e=B(r)
if(!e)continue
const t=f.get(e)??[]
if(t.push(r),f.set(e,t),!g.has(e)){const t=h.get(e)??[]
t.push(r),h.set(e,t)}}return[...l,...Array.from(h,([e,t])=>((e,t)=>{const r=[...t].sort((e,t)=>c(t).localeCompare(c(e)))[0],n=r?c(r):(new Date).toISOString()
return{id:e,name:(a=r,(a?C(a,["customerName","customer_name","name"]):null)??"Ledger customer"),mobile:U(r),type:"udhar",udharAmount:0,totalUdhar:0,createdAt:n,updatedAt:n,created_at:n,updated_at:n,sync_status:"synced",ledger_only:!0}
var a})(e,t))].map(e=>{const t=[...D(P(e),i)].flatMap(e=>f.get(e)??[]),r=((e,t)=>{const r=u(e,t),a=n(v(e.udharAmount??e.totalUdhar,0)),s=y(t)
if(!0===e.balance_derived_from_local_ledger&&s){const t=Math.max(0,a)
return{...r,balance:t,ageing:{...r.ageing,total:t,zeroToSeven:t},isBadCustomer:t>v(e.udharLimit,Number.POSITIVE_INFINITY)}}if(t.length>0)return r
const o=a
return o<=0?r:{...r,balance:o,ageing:{...r.ageing,total:o,zeroToSeven:o},billCount:0,isBadCustomer:o>v(e.udharLimit,Number.POSITIVE_INFINITY),warning:null}})(e,t),a=n(Math.max(0,r.balance))
return{...e,ledgerBalance:a,rawLedgerBalance:r.balance,hasUnsyncedLedgerEntries:y(t),totalUdhar:a,udharAmount:a,ledgerMetrics:r}}).sort((e,t)=>t.ledgerBalance-e.ledgerBalance||e.name.localeCompare(t.name))}async function F(e){const[t,n]=await Promise.all([x(),a.getAll("id_mappings").catch(()=>[])]),c=t.find(t=>D(P(t),n).has(e))
if(!c)return null
const u=D(P(c),n),[d,m,g,f]=await Promise.all([a.getAll("customer_ledger").catch(()=>[]),a.getAll("bills").catch(()=>[]),a.getAll("payments").catch(()=>[]),a.getAll("local_audit_logs").catch(()=>[])]),h=s(d).filter(e=>{const t=B(e)
return!!t&&u.has(t)}),_=r("bills",[]),p=o(L([..._,...m].filter(e=>!M(e)))).filter(e=>{const t=C(e,["customerId","customer_id","serverCustomerId","server_customer_id","localCustomerId","local_customer_id"])
return!!t&&u.has(t)}).sort((e,t)=>String(t.businessDate??t.business_date??t.createdAt??t.created_at??"").localeCompare(String(e.businessDate??e.business_date??e.createdAt??e.created_at??""))),y=g.filter(e=>{const t=C(e,["customerId","customer_id","serverCustomerId","server_customer_id","localCustomerId","local_customer_id"])
return!!t&&u.has(t)}),b=h.map(T).filter(e=>null!==e),I=i([...y,...b]).sort((e,t)=>String(t.paidAt??t.paid_at??t.createdAt??t.created_at??"").localeCompare(String(e.paidAt??e.paid_at??e.createdAt??e.created_at??""))),S=f.filter(e=>String(e.entity_id??"")===c.id||String(e.customerId??e.customer_id??"")===c.id).sort((e,t)=>String(t.createdAt??t.created_at??"").localeCompare(String(e.createdAt??e.created_at??"")))
return{customer:c,bills:p,payments:I,ledger:l(h),audit:S}}function k(e,t){for(const r of t){const t=e[r]
if("string"==typeof t&&t.length>0)return t}return""}function j(e){const t=String(e.billType??e.bill_type??"").toLowerCase()
return t.includes("return")?"return":t.includes("estimate")?"estimate":"sale"}function z(t){const r=[]
for(const e of t.bills){const t=j(e),n=v(e.grandTotal??e.totalAmount??e.netAmount,0),a=Array.isArray(e.items)?e.items.length:0,s=String(e.status??"").toLowerCase(),o=String(e.billNumber??e.billNo??e.id)
r.push({id:`bill:${String(e.id)}`,at:k(e,["businessDate","business_date","createdAt","created_at"]),kind:t,title:"return"===t?`Return ${o}`:"estimate"===t?`Estimate ${o}`:`Bill ${o}`,detail:[a>0?`${a} item${1===a?"":"s"}`:null,String(e.paymentMode??e.refundMode??"")||null,"cancelled"===s?"cancelled":null].filter(Boolean).join(" · ")||null,amount:"return"===t?-Math.abs(n):Math.abs(n),href:`/bills/${String(e.id)}`})}for(const e of t.payments){const t=Boolean(e.reversed_at??e.reversedAt),n=v(e.amount,0)
if(n<0)continue
const a=String(e.mode??"payment").toUpperCase()
r.push({id:`payment:${String(e.id)}`,at:k(e,["paidAt","paid_at","createdAt","created_at"]),kind:t?"payment_reversed":"payment",title:t?`Payment reversed (${a})`:`Payment received (${a})`,detail:"string"==typeof e.note&&e.note.trim()?e.note.trim():null,amount:t?Math.abs(n):-Math.abs(n),href:null})}for(const n of t.ledger){const t=n
e(n)&&r.push({id:`ledger:${String(t.id)}`,at:k(t,["display_date","businessDate","business_date","entry_at","createdAt","created_at"]),kind:"adjustment",title:"Ledger adjustment",detail:"string"==typeof t.note&&t.note.trim()?t.note.trim():null,amount:v(t.signed_amount,0),href:null})}return r.filter(e=>e.at.length>0).sort((e,t)=>t.at.localeCompare(e.at))}function O(e){return t(e)}function Y(e){if(!e)return"Not set"
const t=new Date(String(e)).getTime()
return Number.isFinite(t)?new Date(t).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}):"Not set"}function V(e){if(!e)return"No date"
const t=new Date(String(e)).getTime()
return Number.isFinite(t)?new Date(t).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"No date"}let W=0
async function q(e,t){const r=((e,t)=>{const r=new Map(t.customers.map(e=>[e.customerId,Math.max(0,Number(e.outstanding??0))])),a=[]
for(const s of e){if(s.hasPendingLocalWork)continue
const e=s.ids.find(e=>r.has(e)),t=e?r.get(e)??0:0,o=n(s.localBalance)
g(o)!==g(t)&&a.push({customerId:e??s.ids[0]??"",localBalance:o,serverBalance:t})}return a})(e,t)
if(0===r.length)return!1
if(Date.now()-W<6e5)return!1
W=Date.now()
try{return await f(),await h().catch(()=>{}),!0}catch{return W=0,!1}}export{Y as a,z as b,V as c,q as d,$ as e,O as f,N as g,x as h,F as l,A as p,w as r,I as t}
