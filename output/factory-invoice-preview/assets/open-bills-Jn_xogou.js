import{p as t}from"./billing-calculations-DbfnqEn3.js"
function n(t,n){const e=t.some(t=>t.id===n.id||Boolean(n.sourceOrderId&&t.sourceOrderId===n.sourceOrderId))
return t.length>=10&&!e}const e="kirana-os:billing-draft:v1",r="kirana-os:held-bills:v1"
function o(){return`bill-${Date.now()}-${Math.random().toString(36).slice(2,7)}`}function i(t,n){const e=t.findIndex(t=>t.id===n.id||null!=n.sourceOrderId&&t.sourceOrderId===n.sourceOrderId)
if(e>=0){const r=[...t]
return r[e]={...n,id:r[e].id},r}return[n,...t].slice(0,10)}function a(t,n=Date.now()){const e=new Date(t.createdAt).getTime()
return Number.isFinite(e)?Math.max(0,n-e):0}function s(t,n=Date.now()){return a(t,n)>=432e5}function d(t,n=Date.now()){const e=a(t,n),r=Math.floor(e/6e4)
if(r<1)return"just now"
if(r<60)return`${r}m ago`
const o=Math.floor(r/60)
return o<24?`${o}h ago`:`${Math.floor(o/24)}d ago`}function c(t,n=Date.now()){const e=t.filter(t=>a(t,n)<6048e5)
return{kept:e,archived:t.length-e.length}}function u(t){const{id:n,label:e,createdAt:r,...o}=t
return{...o,activeBillId:n}}function l(t){if(!t?.activeBillId||!t.cart?.length)return null
const n=t.customerName?.trim()||"Walk-in"
return{...t,id:t.activeBillId,label:`${n} • ${t.cart.length} item${1===t.cart.length?"":"s"}`,createdAt:(new Date).toISOString()}}function f(t){const n=new Map
for(const e of t){const t=String(e.productId??"").trim(),r=Number(e.qty??0)
if(!t||!Number.isFinite(r)||r<=0)continue
const o=(e.addons??[]).map(t=>`${t.optionId}x${t.quantity??1}`).sort().join(","),i=`${t}::${e.variation?.unitCode??"default"}::${o}`
n.set(i,Math.round(1e3*((n.get(i)??0)+r))/1e3)}return JSON.stringify([...n.entries()].sort(([t],[n])=>t.localeCompare(n)))}function g(t){const n=t
return[n.id,n.productId,n.server_id,n.serverId,n.local_id,n.localId].filter(t=>"string"==typeof t&&t.trim().length>0)}function p(n,e,r={}){const i=new Map
for(const t of n)for(const n of g(t))i.has(n)||i.set(n,t)
const a=[],s=[],d=[]
for(const{productId:o,qty:c,variation:u,addons:l}of e){const n=i.get(o)
if(!n){s.push(o)
continue}const e=c>0?c:1
d.push({productId:o,qty:e,variation:u,addons:l})
const r=u?.unitCode?(n.sellingUnits??[]).find(t=>t.unitCode===u.unitCode&&!1!==t.isActive):void 0
a.push({product:n,quantity:e,rate:r?Number(r.defaultPrice??0):t(n,e),unit:r?.name??n.rateUnit??n.displayUnit??"piece",sellingUnit:r,addons:l?.map(t=>({...t,quantity:t.quantity??1}))})}return{bill:{id:o(),label:r.label??"QR order",createdAt:new Date(r.now?.()??Date.now()).toISOString(),cart:a,selectedCustomerId:"walk_in",sourceOrderId:r.sourceOrderId,sourceOrderFingerprint:r.sourceOrderId?f(d):void 0},matched:a.length,skipped:s}}export{e as B,r as H,u as a,p as b,s as c,d as f,l as h,f as i,o as n,c as p,i as u,n as w}
