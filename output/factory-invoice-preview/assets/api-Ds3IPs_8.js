import{ak as t,X as n,N as i,aV as o,aH as e,V as a,aI as s,aJ as r,aK as c}from"./index-DbQMpL2c.js"
function u(){return t("/inventory")}function d(){return t("/inventory/low-stock")}function f(n){return t(`/inventory/ledger${o(n)}`)}const y={list:(t="all",n=30)=>`stock-counts:list:v1:${t}:${n}`,detail:t=>`stock-counts:detail:v1:${t}`}
async function l(i,o){if(!a()){const t=await s(o,void 0)
if(void 0!==t)return t
throw new r("This stock count has not been cached on this device yet.",0,{code:"STOCK_COUNT_CACHE_MISSING"})}try{const e=await t(i,{background:!0})
return n(o,e),e}catch(e){if(!c(e))throw e
const t=await s(o,void 0)
if(void 0!==t)return t
throw e}}function w(t){n(y.detail(t.id),t)
const o=y.list("all",30),e=i(o,[]),a=[t,...e.filter(n=>n.id!==t.id)].sort((t,n)=>new Date(n.createdAt).getTime()-new Date(t.createdAt).getTime()).slice(0,30)
return n(o,a),t}function v(t){return i(t,void 0)}function h(t){return e(t)}function m(t="all",n=30){return l(`/inventory/counts${o({status:t,limit:n})}`,y.list(t,n))}function S(t){return l(`/inventory/counts/${t}`,y.detail(t))}async function $(n){return w(await t("/inventory/counts",{method:"POST",body:JSON.stringify(n)}))}async function T(n,i){return w(await t(`/inventory/counts/${n}/lines`,{method:"PATCH",body:JSON.stringify({lines:i})}))}async function g(n){return w(await t(`/inventory/counts/${n}/submit`,{method:"POST"}))}async function O(n,i,o){return w(await t(`/inventory/counts/${n}/${i}`,{method:"POST",ownerPin:o.ownerPin,body:JSON.stringify({ownerPin:o.ownerPin,note:o.note})}))}export{y as S,h as a,m as b,$ as c,O as d,S as e,d as f,u as g,f as h,v as r,g as s,T as u}
