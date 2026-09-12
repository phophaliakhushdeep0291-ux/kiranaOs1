import{j as e}from"./vendor-data-BaHBZjtO.js"
import{am as a,cG as t,cJ as r,ai as s}from"./index-DtTTo2f-.js"
function i({planCode:i,status:n}){const c=a(),d=t(r(i).code,c),o=(e=>e&&"active"!==e?"payment_failed"===e?"failed":e.replace(/_/g," "):"")(n),p=`Rs ${d.price} ${d.name}`,m=o?`${p} - ${o}`:p
return e.jsx(s,{title:m,variant:"expired"===n||"payment_failed"===n?"destructive":"starter"===d.code?"secondary":"default",className:"max-w-[7.5rem] shrink-0 truncate whitespace-nowrap px-2 text-[10px] leading-5",children:p})}export{i as P}
