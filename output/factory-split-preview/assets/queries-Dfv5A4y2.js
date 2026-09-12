import{c as t,d as a}from"./vendor-data-BaHBZjtO.js"
import{aH as n,N as e,V as i,aK as s,J as r,X as o}from"./index-CYG8yywH.js"
import{a as u,g as c}from"./query-options-DZ4mp_BJ.js"
import{c as l,u as d,d as p,l as f}from"./local-actions-YDm1Td9j.js"
const m="suppliers",y=()=>["suppliers"]
function g(){return e(m,[]).filter(t=>null==t.deleted_at)}function w(t){const a=t
return null==a.deleted_at&&null==a.deletedAt}function _(t){const a=t
return!(!0!==a.demo_data&&!t.id.startsWith("demo_")&&!t.id.startsWith("local_"))||"string"!=typeof a.server_id&&"string"!=typeof a.serverId&&["pending_sync","syncing","failed","conflict","local_only"].includes(String(a.sync_status??"").toLowerCase())}function h(t,a){const n=new Map(t.filter(w).map(t=>[t.id,t]))
for(const e of a)w(e)?_(e)&&n.set(e.id,{...n.get(e.id),...e}):n.delete(e.id)
return[...n.values()].sort((t,a)=>t.name.localeCompare(a.name))}async function j(){return r.getAll("suppliers").then(t=>t.filter(w)).catch(()=>[])}function v(a){const e=u(a),c=g()
return t({...e,queryKey:["suppliers"],initialData:e.initialData??c,initialDataUpdatedAt:e.initialDataUpdatedAt??n(m),queryFn:async()=>{const t=g()
if(!i())return h([],[...t,...await j()])
try{const[a,n]=await Promise.all([f(),j()]),e=h(a,[...t,...n])
return(async t=>{o(m,t)
try{await r.putMany("suppliers",t)}catch{}})(e),e}catch(a){if(s(a))return h([],[...t,...await j()])
throw a}}})}function A(t){return a({...c(t),mutationFn:({data:t})=>l(t)})}function D(t){return a({...c(t),mutationFn:({id:t,data:a})=>d(t,a)})}function F(t){return a({...c(t),mutationFn:({id:t,ownerPin:a,reason:n})=>p({id:t,ownerPin:a,reason:n})})}export{A as a,D as b,F as c,y as g,v as u}
