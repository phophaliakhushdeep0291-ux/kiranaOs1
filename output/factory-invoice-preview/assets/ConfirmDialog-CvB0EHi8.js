import{j as e}from"./vendor-data-BaHBZjtO.js"
import{k as s,l as a}from"./index-DbQMpL2c.js"
import{A as r,a as i,b as n,c as t,d,e as l,f as c,g as o}from"./alert-dialog-D_k6xZEk.js"
import{c as m,f as x}from"./vendor-ui-CIi-vqR6.js"
function u({open:u,title:h,description:j,confirmLabel:p,cancelLabel:f,destructive:v=!1,disabled:b=!1,busy:g=!1,onConfirm:C,onCancel:w}){const{t:N}=s(),k=b||g
return e.jsx(r,{open:u,onOpenChange:e=>{e||w()},children:e.jsxs(i,{className:"max-w-md",children:[e.jsxs(n,{children:[e.jsx("div",{className:"mx-auto grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary sm:mx-0",children:g?e.jsx(m,{className:"h-5 w-5 animate-spin","aria-hidden":"true"}):e.jsx(x,{className:a("h-5 w-5",v&&"text-destructive"),"aria-hidden":"true"})}),e.jsx(t,{children:h}),j?e.jsx(d,{children:j}):null]}),e.jsxs(l,{children:[e.jsx(c,{disabled:k,onClick:e=>{e.preventDefault(),w()},children:f??N("chrome.confirmCancel")}),e.jsx(o,{disabled:k,onClick:e=>{e.preventDefault(),C()},className:a(v&&"bg-destructive text-destructive-foreground hover:bg-destructive/90"),children:g?"Please wait…":p})]})]})})}export{u as C}
