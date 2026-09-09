import{ak as e}from"./index-DbQMpL2c.js"
function n(e){if(!e)return""
const n=Object.entries(e).filter(([,e])=>null!=e&&""!==e)
return n.length?`?${new URLSearchParams(n).toString()}`:""}function r(r){return e(`/expenses${n(r)}`)}function t(r){return e(`/expenses/summary${n(r)}`)}function s(){return e("/expenses/overview")}export{t as a,s as g,r as l}
