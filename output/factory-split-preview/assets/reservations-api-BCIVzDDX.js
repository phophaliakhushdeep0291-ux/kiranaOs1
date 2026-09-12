import{ak as t}from"./index-CYG8yywH.js"
const s="/restaurant/service-ops"
function r(r={}){const n=new URLSearchParams
for(const[t,s]of Object.entries(r))s&&n.set(t,String(s))
const e=n.toString()
return t(`${s}/reservations${e?`?${e}`:""}`)}function n(r){return t(`${s}/reservations`,{method:"POST",body:JSON.stringify(r)})}function e(r,n){return t(`${s}/reservations/${r}/status`,{method:"POST",body:JSON.stringify({status:n})})}export{n as c,r as l,e as s}
