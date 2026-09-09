import{c as t,d as e}from"./vendor-data-BaHBZjtO.js"
import{aH as n,N as a,X as r,V as i,aK as o,J as s}from"./index-DbQMpL2c.js"
import{a as c,g as u}from"./query-options-DZ4mp_BJ.js"
import{g as l,f as d,h as f}from"./api-Ds3IPs_8.js"
import{r as m,a as y,s as p,b as g}from"./local-actions-CJ-07oHE.js"
import{n as h}from"./stock-display-Bw0mQIjk.js"
const _="inventory",w="products",S="inventory_movements",b=()=>["inventory"],v=()=>["inventory","low-stock"],A=t=>["inventory","ledger",t??{}]
function N(t){const e=t.product&&"object"==typeof t.product?t.product:null
return{...t,id:String(t.id??t.clientMovementId??t.client_movement_id??""),productName:String(t.productName??t.product_name??e?.name??""),action:String(t.action??t.type??"movement"),quantityDelta:Number(t.quantityDelta??t.quantity_delta??t.changeBaseQty??0),stockBefore:Number(t.stockBefore??t.stock_before??t.oldStockBaseQty??0),stockAfter:Number(t.stockAfter??t.stock_after??t.newStockBaseQty??0),unit:String(t.unit??t.baseUnit??e?.baseUnit??""),actorUserId:t.actorUserId??t.actor_user_id??null,actorName:t.actorName??t.actor_name??null,sourceType:t.sourceType??t.source_type??null,sourceId:t.sourceId??t.source_id??null,createdAt:String(t.createdAt??t.created_at??new Date(0).toISOString()),sync_status:t.sync_status??"synced"}}const D=new Set(["local_only","pending_sync","syncing","failed","conflict"])
function k(t){return D.has(String(t.sync_status??t.syncStatus??t.status??"").toLowerCase())}function q(t){return String(t.productId??t.product_id??"")}function I(t,e){return t.filter(t=>{const n=q(t)
return n.length>0&&e.has(n)})}function U(){return a(_,a(w,[])).map(t=>h(t))}async function B(){try{return(await s.getAll("products")).filter(t=>null==t.deletedAt&&null==t.deleted_at).map(t=>h(t))}catch{return[]}}function F(e){const a=c(e),s=U()
return t({...a,queryKey:["inventory"],initialData:a.initialData??(s.length>0?s:void 0),initialDataUpdatedAt:a.initialDataUpdatedAt??n(_),queryFn:async()=>{const t=U()
if(0===t.length){const t=await B()
if(t.length>0)return r(_,t),t}if(!i()){if(t.length>0)return t
const e=await B()
return e.length>0&&r(_,e),e}try{const t=(await l()).map(t=>h(t))
return r(_,t),t}catch(e){if(t.length>0)return t
if(o(e)){const e=await B()
return e.length>0?(r(_,e),e):t}throw e}}})}function j(){return U().filter(t=>Number(t.stockBaseQty??0)<=Number(t.lowStockThreshold??0))}async function M(){return(await B()).filter(t=>Number(t.stockBaseQty??0)<=Number(t.lowStockThreshold??0))}function Q(e){const a=c(e),r=j()
return t({...a,queryKey:["inventory","low-stock"],initialData:a.initialData??(r.length>0?r:void 0),initialDataUpdatedAt:a.initialDataUpdatedAt??n(_),queryFn:async()=>{const t=j()
if(0===t.length){const t=await M()
if(t.length>0)return t}if(!i())return t.length>0?t:M()
try{return(await d()).map(t=>h(t))}catch(e){if(t.length>0)return t
if(o(e))return M()
throw e}}})}function T(e,n){const u=c(n),l=Number(e?.limit??50),d=()=>{const t=I(a(S,[]),(()=>{const t=[...a(w,[]),...a(_,[])]
return new Set(t.filter(t=>null==t.deletedAt&&null==t.deleted_at).map(t=>String(t.id??"")).filter(Boolean))})()).map(N)
return{entries:t.slice(0,Number.isFinite(l)?l:50),total:t.length}},m=d()
return t({...u,queryKey:A(e),initialData:u.initialData??m,initialDataUpdatedAt:u.initialDataUpdatedAt??0,queryFn:async()=>{const t=d()
if(!i())return t
try{const n=await f(e),[a,i]=await Promise.all([s.getAll(S).catch(()=>[]),s.getAll(w).catch(()=>[])]),o=new Set(i.filter(t=>null==t.deletedAt&&null==t.deleted_at).map(t=>String(t.id??"")).filter(Boolean)),c=((t,e,n=50)=>{const a=new Map
for(const s of t){if(!k(s))continue
const t=N(s)
t.id&&a.set(t.id,t)}const r=t=>{const e=String(t.sourceType??t.source_type??t.reference_type??""),n=t.billId??t.bill_id??("bill"===e?t.sourceId??t.source_id??t.reference_id:void 0),a=q(t),r=String(t.action??t.type??"")
return n&&a&&["sale","return","damage"].includes(r)?JSON.stringify([n,a,r]):void 0},i=new Map,o=new Map
for(const s of e){const t=r(s)
t&&i.set(t,(i.get(t)??0)+Number(N(s).quantityDelta))}for(const s of a.values()){const t=r(s)
t&&o.set(t,[...o.get(t)??[],s])}for(const[s,c]of o){const t=i.get(s),e=c.reduce((t,e)=>t+Number(e.quantityDelta),0)
void 0!==t&&Math.abs(t-e)<1e-6&&c.forEach(t=>a.delete(t.id))}for(const s of e){const t=N(s),e=String(s.clientMovementId??s.client_movement_id??"")
e&&a.delete(e),t.id&&a.set(t.id,t)}return[...a.values()].sort((t,e)=>e.createdAt.localeCompare(t.createdAt)).slice(0,Number.isFinite(n)?n:50)})(I([...t.entries,...a],o),n.entries??[],l)
return r(S,c),{...n,entries:c,total:Math.max(n.total??0,c.length)}}catch(n){if(t.entries.length>0||o(n))return t
throw n}}})}function K(t){return e({...u(t),mutationFn:({data:t})=>m(t)})}function x(t){return e({...u(t),mutationFn:({data:t})=>y(t)})}function C(t){return e({...u(t),mutationFn:({data:t})=>g(t)})}function J(t){return e({...u(t),mutationFn:({data:t})=>p(t)})}export{C as a,x as b,F as c,T as d,Q as e,J as f,b as g,v as h,A as i,K as u}
