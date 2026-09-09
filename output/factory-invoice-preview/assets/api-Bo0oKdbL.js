import{ak as r}from"./index-DbQMpL2c.js"
function t(t,s){const o=new URLSearchParams
t&&"all"!==t&&o.set("status",t),s&&o.set("cursor",s)
const n=o.toString()
return r("/orders"+(n?`?${n}`:""))}function s(t,s){return r(`/orders/${t}`,{method:"PATCH",body:JSON.stringify(s)})}export{t as l,s as u}
