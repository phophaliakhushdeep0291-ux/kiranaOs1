import{j as e}from"./vendor-data-BaHBZjtO.js"
import{L as r}from"./vendor-react-CdF70ZyV.js"
import{k as a,B as s}from"./index-DbQMpL2c.js"
function l({checking:l=!1,onRetry:n}){const{t:c}=a()
return e.jsxs("section",{role:l?"status":"alert",className:"m-4 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950",children:[e.jsx("h2",{className:"font-bold",children:c(l?"sync.local.checking":"sync.local.unavailable")}),!l&&e.jsxs(e.Fragment,{children:[e.jsx("p",{className:"text-sm",children:c("sync.local.unavailableBody")}),e.jsxs("div",{className:"flex flex-wrap gap-3",children:[e.jsx(s,{variant:"outline",onClick:n,children:c("sync.local.retry")}),e.jsx(r,{href:"/recovery-mode",className:"inline-flex min-h-11 items-center underline",children:c("sync.local.recovery")})]})]})]})}export{l as L}
