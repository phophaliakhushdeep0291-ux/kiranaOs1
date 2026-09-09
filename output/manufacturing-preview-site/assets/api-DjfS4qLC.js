import{ak as n}from"./index-Ci-XYli4.js"
function o(){return n("/platform-admin/overview")}function t(){return n("/platform-admin/support/catalog")}function e(o){return n("/platform-admin/support/redeem",{method:"POST",body:JSON.stringify({code:o})})}function r(o,t={}){const e=new URLSearchParams
t.problem&&e.set("problem",t.problem),t.deviceId&&e.set("deviceId",t.deviceId)
const r=e.toString()?`?${e.toString()}`:""
return n(`/platform-admin/support/sessions/${encodeURIComponent(o)}/diagnostics${r}`)}function s(o){return n("/platform-admin/support/commands",{method:"POST",body:JSON.stringify(o)})}function i(o){return n(`/platform-admin/support/sessions/${encodeURIComponent(o)}/settings`)}function a(o){return n("/platform-admin/support/settings",{method:"POST",body:JSON.stringify(o)})}function m(o){return n(`/platform-admin/support/sessions/${encodeURIComponent(o)}`,{method:"DELETE"})}export{t as a,r as b,i as c,s as d,a as e,m as f,o as g,e as r}
