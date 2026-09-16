import{ak as t,aJ as n,J as e}from"./index-DhCGH5L2.js"
import{d as i,l as a}from"./billing-calculations-xtjR86bH.js"
function r(t){if(t instanceof n)return t.data?.code
const e=t
return e?.data?.code??e?.code}async function s(n,e,i){return t("/ai/agent/chat",{method:"POST",body:JSON.stringify({message:n,history:e.slice(-12),...i?.language?{language:i.language}:{},...i?.cart?.length?{cart:i.cart.slice(0,40)}:{}}),signal:i?.signal,timeoutMs:55e3})}async function o(n,e){return t(e?"/ai/agent/confirm-owner":"/ai/agent/confirm",{method:"POST",body:JSON.stringify({planId:n}),...e?{ownerPin:e}:{}})}async function l(n){return t("/ai/agent/reject",{method:"POST",body:JSON.stringify({planId:n})})}function c(t,n,e){let r=[...t]
const s=[],o=[]
for(const l of n){const t=l&&e.get(l.productId)
if(!t||!Number.isFinite(l.quantity)||l.quantity<=0||!Number.isFinite(l.rate)||l.rate<0||"string"!=typeof l.unit){o.push(l)
continue}const n=(t.sellingUnits??[]).filter(t=>!1!==t.isActive),c=l.unit.trim().toLowerCase(),u=n.filter(t=>[t.name,t.unitCode].filter(Boolean).some(t=>String(t).trim().toLowerCase()===c)),g=u.length?u:n.filter(t=>[t.unitType,t.packSizeUnit].filter(Boolean).some(t=>String(t).trim().toLowerCase()===c))
if(n.length&&1!==g.length){o.push(l)
continue}const d=g[0],f={product:t,quantity:l.quantity,rate:l.rate,unit:d?.name??l.unit,sellingUnit:d,manualRate:!0},m=i(f)
r.some(t=>i(t)===m)?r=r.map(t=>i(t)===m?{...t,quantity:a(t.quantity+l.quantity),rate:l.rate,unit:f.unit,sellingUnit:d,manualRate:!0}:t):r.push(f),s.push(l)}return{cart:r,applied:s,remaining:o}}const u="kirana-os:assistant-bill-lines:v1"
async function g(t){const n=(t??[]).filter(t=>t?.productId&&Number(t.quantity)>0)
return 0===n.length?0:(await e.transaction(["settings"],async t=>{const e=await d()
await t.setSetting(u,{lines:[...e?.lines??[],...n],stagedAt:Date.now()})}),n.length)}async function d(){const t=await e.getSetting(u)
if(!t||!Array.isArray(t.lines)||0===t.lines.length)return null
const n=Date.now()-Number(t.stagedAt??0)
return!Number.isFinite(n)||n>18e5?null:t}async function f(t,n,i=()=>!0){return e.transaction(["settings"],async a=>{const r=await e.getSetting(t)??{},s=await d()
if(!i())return null
const o=c(r.cart??[],s?.lines??[],n),l=o.applied.length?{...r,cart:o.cart}:r
if(o.applied.length&&(await a.setSetting(t,l),await a.setSetting(u,{lines:o.remaining,stagedAt:s?.stagedAt??0}),!i()))throw new Error("Billing recovery cancelled")
return{draft:l,added:o.applied.length,remaining:o.remaining.length}})}export{r as a,f as b,o as c,g as d,c as m,l as r,s}
