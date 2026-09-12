import{ak as t,aJ as n,J as a}from"./index-Ci-XYli4.js"
function e(t){if(t instanceof n)return t.data?.code
const a=t
return a?.data?.code??a?.code}async function s(n,a,e){return t("/ai/agent/chat",{method:"POST",body:JSON.stringify({message:n,history:a.slice(-12),...e?.language?{language:e.language}:{},...e?.cart?.length?{cart:e.cart.slice(0,40)}:{}}),signal:e?.signal,timeoutMs:55e3})}async function i(n,a){return t(a?"/ai/agent/confirm-owner":"/ai/agent/confirm",{method:"POST",body:JSON.stringify({planId:n}),...a?{ownerPin:a}:{}})}async function r(n){return t("/ai/agent/reject",{method:"POST",body:JSON.stringify({planId:n})})}const c="kirana-os:assistant-bill-lines:v1"
async function o(t){const n=(t??[]).filter(t=>t?.productId&&Number(t.quantity)>0)
return 0===n.length?0:(await a.transaction(["settings"],async t=>{const a=await g()
await t.setSetting(c,{lines:[...a?.lines??[],...n],stagedAt:Date.now()})}),n.length)}async function g(){const t=await a.getSetting(c)
if(!t||!Array.isArray(t.lines)||0===t.lines.length)return null
const n=Date.now()-Number(t.stagedAt??0)
return!Number.isFinite(n)||n>18e5?null:t}async function u(t=()=>!0){return a.transaction(["settings"],async n=>{const a=await g()
return t()?(await n.setSetting(c,{lines:[],stagedAt:0}),a?.lines??[]):[]})}export{e as a,o as b,i as c,r,s,u as t}
