import{c as a,d as t}from"./vendor-data-BaHBZjtO.js"
import{a as s,g as o}from"./query-options-DZ4mp_BJ.js"
import{cd as r,J as n,ce as e}from"./index-CYG8yywH.js"
import"./vendor-react-CdF70ZyV.js"
const i=()=>["shop"]
function c(t){return a({queryKey:["shop"],queryFn:()=>e(),...s(t)})}function u(a){return t({...o(a),mutationFn:({data:a})=>(async a=>{const t=await r(a)
return await n.setSetting("shop",t).catch(()=>{}),t})(a)})}export{u as a,i as g,c as u}
