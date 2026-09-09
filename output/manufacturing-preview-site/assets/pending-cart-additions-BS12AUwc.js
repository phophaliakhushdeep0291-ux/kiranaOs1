import{J as t}from"./index-Ci-XYli4.js"
const n="kirana-os:billing-pending-adds:v1"
function a(t){const n=t
return Boolean(n&&"string"==typeof n.productId&&n.productId)}async function i(i){const r=i.filter(a)
if(0===r.length)return
const e=await t.getSetting(n).catch(()=>null),c=(Array.isArray(e)?e.filter(a):[]).concat(r)
await t.setSetting(n,c).catch(()=>{})}async function r(){const i=await t.getSetting(n).catch(()=>null),r=Array.isArray(i)?i.filter(a):[]
return r.length>0&&await t.delete("settings",n).catch(()=>{}),r}export{i as q,r as t}
