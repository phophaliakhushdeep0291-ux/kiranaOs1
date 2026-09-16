import{ak as t,aJ as n,J as e}from"./index-C-jOBSyf.js"
import{d as i,l as a}from"./billing-calculations-BtOioO4I.js"
function s(t){if(t instanceof n)return t.data?.code
const e=t
return e?.data?.code??e?.code}async function r(n,e,i){return t("/ai/agent/chat",{method:"POST",body:JSON.stringify({message:n,history:e.slice(-12),...i?.language?{language:i.language}:{},...i?.cart?.length?{cart:i.cart.slice(0,40)}:{}}),signal:i?.signal,timeoutMs:55e3})}async function o(n,e){return t(e?"/ai/agent/confirm-owner":"/ai/agent/confirm",{method:"POST",body:JSON.stringify({planId:n}),...e?{ownerPin:e}:{}})}async function l(n){return t("/ai/agent/reject",{method:"POST",body:JSON.stringify({planId:n})})}function c(t,n,e){let s=[...t]
const r=[],o=[]
for(const l of n){const t=l&&e.get(l.productId)
if(!t||!Number.isFinite(l.quantity)||l.quantity<=0||!Number.isFinite(l.rate)||l.rate<0||"string"!=typeof l.unit){o.push(l)
continue}const n=(t.sellingUnits??[]).filter(t=>!1!==t.isActive),c=l.unit.trim().toLowerCase(),u=n.filter(t=>[t.name,t.unitCode].filter(Boolean).some(t=>String(t).trim().toLowerCase()===c)),g=l.sellingUnitId?n.filter(t=>t.id===l.sellingUnitId):u.length?u:n.filter(t=>String(t.unitType).trim().toLowerCase()===c)
if((n.length||l.sellingUnitId)&&1!==g.length){o.push(l)
continue}const d=g[0]
if(d&&void 0!==l.conversionToBase&&l.conversionToBase!==Number(d.conversionToBase)){o.push(l)
continue}const f=d?.defaultPrice??t.defaultPricePerRateUnit
if(null!=f&&Math.abs(Number(f)-l.rate)>.001){o.push(l)
continue}const m={product:t,quantity:l.quantity,rate:l.rate,unit:d?.name??l.unit,sellingUnit:d,manualRate:!0},y=i(m)
s.some(t=>i(t)===y)?s=s.map(t=>i(t)===y?{...t,quantity:a(t.quantity+l.quantity),rate:l.rate,unit:m.unit,sellingUnit:d,manualRate:!0}:t):s.push(m),r.push(l)}return{cart:s,applied:r,remaining:o}}const u="kirana-os:assistant-bill-lines:v1"
async function g(t){const n=(t??[]).filter(t=>t?.productId&&Number(t.quantity)>0)
return 0===n.length?0:(await e.transaction(["settings"],async t=>{const e=await d()
await t.setSetting(u,{lines:[...e?.lines??[],...n],stagedAt:Date.now()})}),n.length)}async function d(){const t=await e.getSetting(u)
if(!t||!Array.isArray(t.lines)||0===t.lines.length)return null
const n=Date.now()-Number(t.stagedAt??0)
return!Number.isFinite(n)||n>18e5?null:t}async function f(t,n,i=()=>!0){return e.transaction(["settings"],async a=>{const s=await e.getSetting(t)??{},r=await d()
if(!i())return null
const o=c(s.cart??[],r?.lines??[],n),l=o.applied.length?{...s,cart:o.cart}:s
if(o.applied.length&&(await a.setSetting(t,l),await a.setSetting(u,{lines:o.remaining,stagedAt:r?.stagedAt??0}),!i()))throw new Error("Billing recovery cancelled")
return{draft:l,added:o.applied.length,remaining:o.remaining.length}})}export{s as a,f as b,o as c,g as d,c as m,l as r,r as s}
