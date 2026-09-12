import{ak as e}from"./index-Ci-XYli4.js"
import{a as t,c as o}from"./share-oCVuUOdG.js"
const n="kirana:bill-whatsapp-intents:v1"
function a(){try{const e=JSON.parse(localStorage.getItem(n)||"[]")
return Array.isArray(e)?e:[]}catch{return[]}}function s(e){localStorage.setItem(n,JSON.stringify(e))}async function i(n){if("undefined"!=typeof navigator&&!navigator.onLine){const e=a()
return e.some(e=>e.idempotencyKey===n.idempotencyKey)||s([...e,n]),{state:"not_sent",queued:!0}}const i=await e(`/bills/${encodeURIComponent(n.billId)}/whatsapp`,{method:"POST",body:JSON.stringify({idempotencyKey:n.idempotencyKey,customerMobile:n.input.customerMobile,showGst:n.showGst,showPreviousUdhar:n.showPreviousUdhar,mode:"auto"})})
return"api"===i.data.path?{state:i.data.state}:window.open(i.data.message?t(n.input.customerMobile,i.data.message):o(n.input),"_blank","noopener,noreferrer")?(await e(`/bills/${encodeURIComponent(n.billId)}/whatsapp`,{method:"POST",body:JSON.stringify({idempotencyKey:n.idempotencyKey,showGst:n.showGst,showPreviousUdhar:n.showPreviousUdhar,mode:"deep_link_opened"})}),{state:"opened_share_sheet"}):{state:"not_sent"}}"undefined"!=typeof window&&window.addEventListener("online",()=>{(async(e=i)=>{for(const t of a())try{(await e(t)).queued||s(a().filter(e=>e.idempotencyKey!==t.idempotencyKey))}catch{}})()})
export{i as d}
