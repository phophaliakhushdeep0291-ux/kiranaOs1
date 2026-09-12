import{c as t}from"./vendor-data-BaHBZjtO.js"
import{ak as a,aV as n,aH as i,aW as e,aX as l,R as r,M as s,X as o,J as u,N as c,Z as m,V as b,aK as d}from"./index-CYG8yywH.js"
import{a as f}from"./query-options-DZ4mp_BJ.js"
function g(t){return a("/bills/confirm",{method:"POST",body:JSON.stringify(t)})}function y(t){return a(`/bills${n(t)}`)}const p="bills",h=t=>["bills",t??{}]
function _(t){const a=t,n=t.businessDate??t.business_date??t.createdAt??a.created_at??a.billDate??a.date,i="string"==typeof n||n instanceof Date?new Date(n).getTime():0
return Number.isFinite(i)?i:0}function A(t){return t.map(t=>({bill:t,at:_(t)})).sort((t,a)=>a.at-t.at).map(t=>t.bill)}function w(t){return e((t=>{const a=t
if(!Array.isArray(a.payments))return t
const n=String(t.id??""),i=String(t.customerId??t.customer_id??""),e=m(a.payments.map(t=>{const a=t&&"object"==typeof t?t:{}
return{...a,billId:a.billId??a.bill_id??n,bill_id:a.bill_id??a.billId??n,customerId:a.customerId??a.customer_id??i,customer_id:a.customer_id??a.customerId??i}}))
return{...t,payments:e}})({...t,billNumber:t.billNumber??t.billNo,totalAmount:t.totalAmount??t.grandTotal??0,netAmount:t.netAmount??t.grandTotal??0}))}async function N(t){const a=l(s(t.map(w)),r)
o(p,a,r)
try{await u.putMany("bills",a),await u.pruneStoreOlderThan("bills",r)}catch{}}function D(){return A(s(c(p,[]).map(w)))}function I(a,n){const e=f(n),l=D()
return t({...e,queryKey:h(a),initialData:e.initialData??{bills:l,total:l.length},initialDataUpdatedAt:e.initialDataUpdatedAt??i(p),queryFn:async()=>{const t=D()
if(!b())return{bills:t,total:t.length}
try{const n=await y(a),i=(n.bills??[]).map(w),e=s([...t.filter(t=>{const a=t.sync_status
return"pending_sync"===a||"syncing"===a||"failed"===a||"pending_sync"===t.status}),...i])
return N(e),{...n,bills:e,total:e.length}}catch(n){if(t.length>0)return{bills:t,total:t.length}
if(d(n)){const t=await(async t=>{try{const a=await u.getAll("bills"),n=String(t?.search??"").trim().toLowerCase(),i=a.filter(t=>null==t.deletedAt).map(w),e=n?i.filter(t=>String(t.billNumber??t.billNo??"").toLowerCase().includes(n)):i,l=A(s(e)),r=Number(t?.limit??e.length)
return l.slice(0,Number.isFinite(r)&&r>0?r:l.length)}catch{return[]}})(a)
if(t.length>0)return N(t),{bills:t,total:t.length}}if(d(n))return{bills:t,total:t.length}
throw n}}})}export{g as a,N as c,h as g,y as l,I as u,w}
