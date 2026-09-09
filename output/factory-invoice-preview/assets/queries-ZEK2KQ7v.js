import{c as t,d as n}from"./vendor-data-BaHBZjtO.js"
import{aH as a,N as e,an as r,X as i,aP as o,J as s,aQ as c,aR as u,aS as d,W as l,V as f,aK as y}from"./index-DbQMpL2c.js"
import{a as m,g as p}from"./query-options-DZ4mp_BJ.js"
const h=t=>["products",r()??"company",t??{}]
function g(t,n){const a=String(n?.search??"").trim().toLowerCase(),e=t.filter(t=>null==t.deletedAt&&null==t.deleted_at),r=Number(n?.limit??e.length),i=a?e.filter(t=>t.name.toLowerCase().includes(a)||t.category?.toLowerCase().includes(a)||t.aliases?.some(t=>t.toLowerCase().includes(a))):e
return i.slice(0,Number.isFinite(r)&&r>0?r:i.length)}function w(){return`products:${r()??"company"}`}async function _(t){i(w(),t,o)
try{await s.putMany("products",t)}catch{}}function v(t){return g(e(w(),[]),t)}async function I(t){try{const n=await s.getAll("products"),a=r()
return g(a&&n.some(t=>Boolean(t.inventoryLocationId))?n.filter(t=>t.inventoryLocationId===a):n,t)}catch{return[]}}async function L(){try{return await l()}catch{return await I()}}function A(t){const n=t
return[t.id,n.productId,n.local_id,n.server_id,n.localId,n.serverId,n.clientProductId,n.client_product_id].filter(t=>"string"==typeof t&&t.length>0)}function C(t){const n=t
return!(!0!==n.demo_data&&!t.id.startsWith("demo_")&&!t.id.startsWith("local_"))||("string"==typeof n.server_id||n.serverId,["pending_sync","syncing","failed","conflict","local_only"].includes(String(n.sync_status??"").toLowerCase()))}function F(t,n,a=!1){const e=[],r=new Map,i=t=>{const n=A(t),a=n.map(t=>r.get(t)).find(t=>void 0!==t)
if(void 0===a){const a=e.push(t)-1
return void n.forEach(t=>r.set(t,a))}e[a]={...e[a],...t},A(e[a]).forEach(t=>r.set(t,a))}
t.forEach(i)
for(const o of n)(a||C(o))&&(null!=o.deletedAt||null!=o.deleted_at?A(o).map(t=>r.get(t)).filter(t=>void 0!==t).forEach(t=>{e[t]={...e[t],...o}}):i(o))
return e}function D(n,e){const r=m(e),i=v(n)
return t({...r,queryKey:h(n),initialData:r.initialData??(i.length>0?i:void 0),initialDataUpdatedAt:r.initialDataUpdatedAt??a(w()),queryFn:async()=>{const t=F([],[...v(n),...await I(n)],!0)
if(!f())return g(t,n)
try{const a=await l(n)
if(n?.search)return _(F(await l({limit:500}),t)),g(F(a,t),n)
const e=g(F(a,t),n)
return _(e),e}catch(a){if(y(a))return g(t,n)
throw a}}})}function E(t){return n({...p(t),mutationFn:({data:t})=>c(t)})}function P(t){return n({...p(t),mutationFn:({id:t,data:n})=>u(t,n)})}function b(t){return n({...p(t),mutationFn:({id:t,ownerPin:n,reason:a})=>d(t,n,a)})}export{E as a,P as b,_ as c,b as d,h as g,L as l,D as u}
