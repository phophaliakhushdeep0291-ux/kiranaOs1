import{an as a,ak as e,X as t,J as r,aH as i,N as n,V as s,aI as l,aJ as o,aK as c,aV as y}from"./index-DbQMpL2c.js"
const u={list:(e="all",t,r=a()??"primary")=>`inventory-lots:list:v1:${r}:${e}:${t??"all"}`,alerts:(e=a()??"primary")=>`inventory-lots:expiry-alerts:v1:${e}`,sellable:(e,t=a()??"primary")=>`inventory-lots:sellable:v1:${t}:${e}`}
function b(a){return a&&"primary"!==a?{headers:{"x-location-id":a}}:void 0}async function p(a,r,i){if(!s()){const a=await l(r,void 0)
if(void 0!==a)return a
throw new o("Batch and expiry data has not been cached on this device yet.",0,{code:"INVENTORY_LOT_CACHE_MISSING"})}try{const n=await e(a,{background:!0,...b(i)})
return t(r,n),n}catch(n){if(!c(n))throw n
const a=await l(r,void 0)
if(void 0!==a)return a
throw n}}function m(a){return n(a,void 0)}function d(a){return i(a)}function v(a,e){return t(a,e),e}const h=(e={})=>{const t=e.status??"all",r=e.locationId??a()??"primary"
return p(`/inventory-lots${y({status:t,expiringWithinDays:e.expiringWithinDays,limit:500})}`,u.list(t,e.expiringWithinDays,r),r)},x=(e={})=>{const t=e.locationId??a()??"primary"
return p(`/inventory-lots/expiry-alerts${y({criticalDays:e.criticalDays,warningDays:e.warningDays})}`,u.alerts(t),t)},f=(e,t=a()??"primary")=>p(`/inventory-lots/sellable/${e}`,u.sellable(e,t),t),N=(a,t,r,i)=>e(`/inventory-lots/${a}/status`,{method:"POST",ownerPin:i,body:JSON.stringify({status:t,note:r})})
async function O(e,t){const i=u.sellable(e,t??a()??"primary")
return r.getRecentCache(i,void 0)}function $(a,e){const t=Math.abs(Number(e.quantityBaseQty||0))
if(!(t>0))return a
if("purchase"===e.movementType&&e.batchNumber&&e.expiresOn){const r=a??[],i=r.find(a=>a.batchNumber===e.batchNumber&&a.expiresOn.slice(0,10)===e.expiresOn?.slice(0,10))
return(i?r.map(a=>a.id===i.id?{...a,availableBaseQty:Number(a.availableBaseQty)+t,mrp:e.batchMrp??a.mrp}:a):[...r,{id:`local-batch:${e.productId}:${e.batchNumber}:${e.expiresOn}`,batchNumber:e.batchNumber,expiresOn:e.expiresOn,availableBaseQty:t,mrp:e.batchMrp??null,pendingSync:!0}]).sort((a,e)=>a.expiresOn.localeCompare(e.expiresOn))}if(!a)return
if(e.inventoryLotId||e.batchNumber)return a.map(a=>(e.inventoryLotId?a.id!==e.inventoryLotId:a.batchNumber!==e.batchNumber||e.expiresOn&&a.expiresOn.slice(0,10)!==e.expiresOn.slice(0,10))?a:{...a,availableBaseQty:Math.max(0,Number(a.availableBaseQty)-t)}).filter(a=>a.availableBaseQty>0)
let r=t
return a.map(a=>{if(r<=0)return a
const e=Math.min(r,Number(a.availableBaseQty))
return r-=e,{...a,availableBaseQty:Math.max(0,Number(a.availableBaseQty)-e)}}).filter(a=>a.availableBaseQty>0)}export{u as I,v as a,O as b,N as c,f as d,x as g,d as i,h as l,$ as p,m as r}
