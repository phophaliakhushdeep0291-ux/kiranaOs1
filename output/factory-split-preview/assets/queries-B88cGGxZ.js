import{c as t}from"./vendor-data-BaHBZjtO.js"
import{ak as a,aV as e,aH as n,J as r,Q as o,X as i,N as s,V as c,aK as l}from"./index-CYG8yywH.js"
import{a as u}from"./query-options-DZ4mp_BJ.js"
import{g as d,d as m,e as f,f as h}from"./local-actions-CZfcmK2q.js"
function p(t){return a(`/customers${e(t)}`)}const y="customers",_=new Set(["pending_sync","syncing","failed","local_only"]),g=t=>["customers",t??{}]
function w(t){const a=Number(t.udharAmount??t.totalUdhar??0),e=Number.isFinite(a)?Math.max(0,a):0
return{...t,udharAmount:e,totalUdhar:e}}function A(t,a){const e=String(a?.search??"").trim().toLowerCase(),n=t.filter(t=>null==t.deletedAt&&null==t.deleted_at),r=Number(a?.limit??n.length),o=e?n.filter(t=>t.name.toLowerCase().includes(e)||t.mobile?.includes(e)):n
return o.slice(0,Number.isFinite(r)&&r>0?r:o.length)}async function U(t){try{const a=await r.transaction(["customers","customer_ledger"],async a=>{const[e,n]=await Promise.all([r.getAll("customers"),r.getAll("customer_ledger")]),i=new Map
for(const t of e)for(const a of v(t))i.set(a,t)
const s=new Set
for(const t of n){if(null!=t.deleted_at||null!=t.deletedAt||null!=t.merged_into_id||null!=t.mergedIntoId)continue
if(!_.has(String(t.sync_status??"").toLowerCase()))continue
const a=o(t)
null!==a&&s.add(a)}const c=N(t.map(t=>{const a=v(t).map(t=>i.get(t)).find(Boolean),e=v(a||t).some(t=>s.has(t))
return a&&e&&!0===a.balance_derived_from_local_ledger?{...a,...t,type:Number(a.udharAmount??a.totalUdhar??0)>0?"udhar":t.type,udharAmount:a.udharAmount,totalUdhar:a.totalUdhar,balance_derived_from_local_ledger:!0}:{...a,...t}}),e).map(w)
return await a.putMany("customers",c),c})
return i(y,a),a}catch{return N(t,b()).map(w)}}function b(t){return A(s(y,[]),t).map(w)}function v(t){const a=t
return[t.id,a.local_id,a.server_id,a.localId,a.serverId].filter(t=>"string"==typeof t&&t.length>0)}function D(t){const a=t
return!0===a.demo_data||t.id.startsWith("demo_")||t.id.startsWith("local_")||["pending_sync","syncing","failed","conflict","local_only"].includes(String(a.sync_status??"").toLowerCase())}function N(t,a,e=!1){const n=[],r=new Map,o=t=>{const a=v(t),e=a.map(t=>r.get(t)).find(t=>void 0!==t)
if(void 0===e){const e=n.push(t)-1
return void a.forEach(t=>r.set(t,e))}n[e]={...n[e],...t},v(n[e]).forEach(t=>r.set(t,e))}
t.forEach(o)
for(const i of a)(e||D(i))&&o(i)
return n.filter(t=>null==t.deletedAt&&null==t.deleted_at)}function q(a,e){const o=u(e),i=b(a)
return t({...o,queryKey:g(a),initialData:o.initialData??i,initialDataUpdatedAt:o.initialDataUpdatedAt??n(y),queryFn:async()=>{const t=b(a),e=await(async t=>{try{return A(await r.getAll("customers"),t).map(w)}catch{return[]}})(a),n=N([],[...t,...e],!0)
if(!c())return A(n,a).map(w)
try{const t=(await p(a)).map(w)
if(a?.search){const e=await p({limit:1e3})
return A(N(t,await U(e)),a).map(w)}return A(await U(t),a)}catch(o){if(l(o))return A(n,a).map(w)
throw o}}})}function S(a){const e=u(a),r=d()
return t({...e,queryKey:["udhar","summary"],initialData:e.initialData??r,initialDataUpdatedAt:e.initialDataUpdatedAt??n(y),queryFn:async()=>{if(!c())return m()
try{const t=await f()
return h(t),t}catch(t){if(l(t))return m()
throw t}}})}export{q as a,U as c,p as l,S as u}
