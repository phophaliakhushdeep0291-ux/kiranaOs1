import{c as t}from"./vendor-data-BaHBZjtO.js"
import{aH as a,J as e,Q as n,X as r,N as o,V as i,aK as s}from"./index-DtTTo2f-.js"
import{a as l}from"./query-options-DZ4mp_BJ.js"
import{l as c}from"./api-3hKDFzft.js"
import{g as u,d,e as m,f}from"./local-actions-5oKsoXJk.js"
const h="customers",p=new Set(["pending_sync","syncing","failed","local_only"]),y=t=>["customers",t??{}]
function _(t){const a=Number(t.udharAmount??t.totalUdhar??0),e=Number.isFinite(a)?Math.max(0,a):0
return{...t,udharAmount:e,totalUdhar:e}}function g(t,a){const e=String(a?.search??"").trim().toLowerCase(),n=t.filter(t=>null==t.deletedAt&&null==t.deleted_at),r=Number(a?.limit??n.length),o=e?n.filter(t=>t.name.toLowerCase().includes(e)||t.mobile?.includes(e)):n
return o.slice(0,Number.isFinite(r)&&r>0?r:o.length)}async function w(t){try{const a=await e.transaction(["customers","customer_ledger"],async a=>{const[r,o]=await Promise.all([e.getAll("customers"),e.getAll("customer_ledger")]),i=new Map
for(const t of r)for(const a of U(t))i.set(a,t)
const s=new Set
for(const t of o){if(null!=t.deleted_at||null!=t.deletedAt||null!=t.merged_into_id||null!=t.mergedIntoId)continue
if(!p.has(String(t.sync_status??"").toLowerCase()))continue
const a=n(t)
null!==a&&s.add(a)}const l=v(t.map(t=>{const a=U(t).map(t=>i.get(t)).find(Boolean),e=U(a||t).some(t=>s.has(t))
return a&&e&&!0===a.balance_derived_from_local_ledger?{...a,...t,type:Number(a.udharAmount??a.totalUdhar??0)>0?"udhar":t.type,udharAmount:a.udharAmount,totalUdhar:a.totalUdhar,balance_derived_from_local_ledger:!0}:{...a,...t}}),r).map(_)
return await a.putMany("customers",l),l})
return r(h,a),a}catch{return v(t,A()).map(_)}}function A(t){return g(o(h,[]),t).map(_)}function U(t){const a=t
return[t.id,a.local_id,a.server_id,a.localId,a.serverId].filter(t=>"string"==typeof t&&t.length>0)}function b(t){const a=t
return!0===a.demo_data||t.id.startsWith("demo_")||t.id.startsWith("local_")||["pending_sync","syncing","failed","conflict","local_only"].includes(String(a.sync_status??"").toLowerCase())}function v(t,a,e=!1){const n=[],r=new Map,o=t=>{const a=U(t),e=a.map(t=>r.get(t)).find(t=>void 0!==t)
if(void 0===e){const e=n.push(t)-1
return void a.forEach(t=>r.set(t,e))}n[e]={...n[e],...t},U(n[e]).forEach(t=>r.set(t,e))}
t.forEach(o)
for(const i of a)(e||b(i))&&o(i)
return n.filter(t=>null==t.deletedAt&&null==t.deleted_at)}function D(n,r){const o=l(r),u=A(n)
return t({...o,queryKey:y(n),initialData:o.initialData??u,initialDataUpdatedAt:o.initialDataUpdatedAt??a(h),queryFn:async()=>{const t=A(n),a=await(async t=>{try{return g(await e.getAll("customers"),t).map(_)}catch{return[]}})(n),r=v([],[...t,...a],!0)
if(!i())return g(r,n).map(_)
try{const t=(await c(n)).map(_)
if(n?.search){const a=await c({limit:1e3})
return g(v(t,await w(a)),n).map(_)}return g(await w(t),n)}catch(o){if(s(o))return g(r,n).map(_)
throw o}}})}function N(e){const n=l(e),r=u()
return t({...n,queryKey:["udhar","summary"],initialData:n.initialData??r,initialDataUpdatedAt:n.initialDataUpdatedAt??a(h),queryFn:async()=>{if(!i())return d()
try{const t=await m()
return f(t),t}catch(t){if(s(t))return d()
throw t}}})}export{D as a,w as c,N as u}
