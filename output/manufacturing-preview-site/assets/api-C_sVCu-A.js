import{ak as t,J as n,aJ as o}from"./index-Ci-XYli4.js"
const a="offers:server-cache:v1"
async function e(){try{const o=await t("/offers",{background:!0})
return await n.setSetting(a,o).catch(()=>{}),o}catch(e){if(e instanceof o&&e.status>0&&e.status<500&&![408,429].includes(e.status))throw e
const t=await n.getSetting(a).catch(()=>{})
if(t)return t
throw e}}function s(n,o){return t("/offers",{method:"POST",ownerPin:o.ownerPin,body:JSON.stringify({...n,auditReason:o.auditReason||void 0})})}function i(n,o,a){return t(`/offers/${n}`,{method:"PATCH",ownerPin:a.ownerPin,body:JSON.stringify({...o,auditReason:a.auditReason||void 0})})}function r(n,o){return t(`/offers/${n}`,{method:"DELETE",ownerPin:o.ownerPin,body:JSON.stringify({auditReason:o.auditReason||void 0})})}function f(n,o){return t("/offers/apply",{method:"POST",body:JSON.stringify({subtotal:n,code:o})})}export{f as a,s as c,r as d,e as l,i as u}
