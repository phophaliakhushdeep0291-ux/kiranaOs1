import{ak as t,J as n,aJ as r}from"./index-DtTTo2f-.js"
const s="prescriptions:server-cache:v1"
async function e(e={}){try{const r=await t(`/prescriptions${(t=>{const n=new URLSearchParams
for(const[s,e]of Object.entries(t))e&&n.set(s,String(e))
const r=n.toString()
return r?`?${r}`:""})(e)}`,{background:!0})
return 0===Object.keys(e).length&&await n.setSetting(s,r).catch(()=>{}),r}catch(i){if(i instanceof r&&i.status>0&&i.status<500&&![408,429].includes(i.status))throw i
const t=await n.getSetting(s).catch(()=>{})
if(t)return t
throw i}}function i(){return t("/prescriptions/summary",{background:!0})}function o(n){return t("/prescriptions",{method:"POST",body:JSON.stringify(n)})}function c(n,r){return t(`/prescriptions/${n}`,{method:"PATCH",body:JSON.stringify(r)})}function a(n,r={}){return t(`/prescriptions/${n}/dispense`,{method:"POST",body:JSON.stringify(r)})}function u(n,r){return t(`/prescriptions/${n}/cancel`,{method:"POST",body:JSON.stringify({reason:r})})}function p(n){return t(`/prescriptions/${n}`,{method:"DELETE"})}export{u as a,p as b,o as c,a as d,i as g,e as l,c as u}
