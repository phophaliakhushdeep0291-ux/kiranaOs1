import{J as t}from"./index-CYG8yywH.js"
function n(...t){const n=new Map
for(const e of t)for(const t of e??[]){if(!t?.id||!t.name)continue
const e={...t,updatedAt:t.updatedAt??t.createdAt,deletedAt:t.deletedAt??null},a=n.get(t.id);(!a||String(e.updatedAt)>String(a.updatedAt??a.createdAt))&&n.set(t.id,e)}return[...n.values()]}const e="kirana:categories:v1"
function a(){try{return crypto.randomUUID()}catch{return`cat_${Date.now()}_${Math.random().toString(36).slice(2,8)}`}}async function o(){return await t.getSetting(e).catch(()=>null)??null}async function s(n){await t.setSetting(e,n).catch(()=>{})}function c(t){const n=new Map
for(const e of t??[]){const t=e?.name?.trim()
if(!t||e.deletedAt||"active"!==e.status)continue
const a=t.toLocaleLowerCase()
n.has(a)||n.set(a,t)}return[...n.values()].sort((t,n)=>t.localeCompare(n,void 0,{sensitivity:"base"}))}function r(t,n){const e=new Set,a=t=>{for(const o of n)o.parentId!==t||e.has(o.id)||(e.add(o.id),a(o.id))}
return a(t),e}export{c as a,r as d,o as l,n as m,a as n,s}
